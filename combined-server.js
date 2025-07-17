const express = require('express');
const fs = require('fs');
const { exec } = require('child_process');
const path = require('path');
const WebSocket = require('ws');
const pty = require('node-pty');

const app = express();
app.use(express.json());

const TMP_DIR = path.resolve(process.cwd(), 'tmp');
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR);

// REST endpoint: Run Python code
app.post('/run-python', (req, res) => {
  const code = req.body.code;
  if (!code) return res.status(400).json({ error: 'No code provided' });
  const filePath = path.join(TMP_DIR, `script_${Date.now()}.py`);
  fs.writeFileSync(filePath, code);
  exec(`python3 ${filePath}`, (error, stdout, stderr) => {
    fs.unlinkSync(filePath);
    if (error) return res.json({ error: stderr || error.message });
    res.json({ output: stdout });
  });
});

// REST endpoint: Run C++ code
app.post('/run-cpp', (req, res) => {
  const code = req.body.code;
  if (!code) return res.status(400).json({ error: 'No code provided' });
  const cppPath = path.join(TMP_DIR, `code_${Date.now()}.cpp`);
  const exePath = path.join(TMP_DIR, `code_${Date.now()}`);
  fs.writeFileSync(cppPath, code);
  exec(`g++ ${cppPath} -o ${exePath} && ${exePath}`, (error, stdout, stderr) => {
    fs.unlinkSync(cppPath);
    if (fs.existsSync(exePath)) fs.unlinkSync(exePath);
    if (error) return res.json({ error: stderr || error.message });
    res.json({ output: stdout });
  });
});

const server = app.listen(process.env.PORT || 3000, () => {
  console.log(`Server running on port ${process.env.PORT || 3000}`);
});

// WebSocket server for interactive shell
const wss = new WebSocket.Server({ server });
const PROJECT_ROOT_TMP_DIR = TMP_DIR;

wss.on('connection', ws => {
  console.log('WebSocket client connected');
  ws.send(JSON.stringify({ type: 'info', data: ' ' }));
  let ptyProcess = null;

  ws.on('message', message => {
    let parsedMessage;
    try {
      parsedMessage = JSON.parse(message);
    } catch (e) {
      ws.send(JSON.stringify({ type: 'stdout', data: '\r\n\x1b[31mError: Invalid message format received by server.\x1b[0m\r\n' }));
      return;
    }
    if (parsedMessage.type === 'execute' && parsedMessage.command) {
      if (ptyProcess) ptyProcess.kill();
      if (parsedMessage.command.includes('..')) {
        ws.send(JSON.stringify({ type: 'stdout', data: '\r\n\x1b[31mError: Invalid command (directory traversal detected).\x1b[0m\r\n' }));
        return;
      }
      const commandParts = parsedMessage.command.split(' ');
      const cmd = commandParts[0];
      const args = commandParts.slice(1);
      try {
        ptyProcess = pty.spawn(cmd, args, {
          name: 'xterm-color',
          cols: parsedMessage.cols || 80,
          rows: parsedMessage.rows || 24,
          cwd: PROJECT_ROOT_TMP_DIR,
          env: process.env,
        });
        ptyProcess.onData(data => {
          ws.send(JSON.stringify({ type: 'stdout', data }));
        });
        ptyProcess.on('exit', ({ exitCode, signal }) => {
          ws.send(JSON.stringify({ type: 'exit', code: exitCode }));
          ptyProcess = null;
        });
      } catch (e) {
        ws.send(JSON.stringify({ type: 'stdout', data: `\r\n\x1b[31mServer Error: Failed to spawn PTY process. ${e.message}\x1b[0m\r\n` }));
        ws.send(JSON.stringify({ type: 'exit', code: 1 }));
        ptyProcess = null;
      }
    } else if (parsedMessage.type === 'stdin' && ptyProcess) {
      ptyProcess.write(parsedMessage.data);
    } else if (parsedMessage.type === 'resize' && ptyProcess) {
      ptyProcess.resize(parsedMessage.cols, parsedMessage.rows);
    }
  });

  ws.on('close', () => {
    if (ptyProcess) ptyProcess.kill();
    ptyProcess = null;
  });

  ws.on('error', () => {
    if (ptyProcess) ptyProcess.kill();
    ptyProcess = null;
  });
});
