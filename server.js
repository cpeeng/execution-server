
const WebSocket = require('ws');
const pty = require('node-pty');
const path = require('path');

const wss = new WebSocket.Server({ port: 8080 });

const PROJECT_ROOT_TMP_DIR = path.resolve(process.cwd(), 'tmp');

console.log('WebSocket interactive execution server started on ws://localhost:8080');
console.log(`Executing commands from CWD: ${PROJECT_ROOT_TMP_DIR}`);

wss.on('connection', ws => {
  console.log('Client connected');
  try {
    ws.send(JSON.stringify({ type: 'info', data: ' ' }));
  } catch (e) {
    console.error('Failed to send welcome message:', e);
  }

  let ptyProcess = null;

  ws.on('message', message => {
    let parsedMessage;
    try {
      parsedMessage = JSON.parse(message);
    } catch (e) {
      console.error('Invalid JSON received:', message);
       try {
        ws.send(JSON.stringify({ type: 'stdout', data: '\r\n\x1b[31mError: Invalid message format received by server.\x1b[0m\r\n' }));
      } catch (wsErr) {}
      return;
    }

    console.log('Received message:', parsedMessage);

    if (parsedMessage.type === 'execute' && parsedMessage.command) {
      if (ptyProcess) {
        console.log('A process is already running. Terminating old one.');
        ptyProcess.kill();
        ptyProcess = null;
      }
      
      if (parsedMessage.command.includes('..')) {
        const errorMsg = '\r\n\x1b[31mError: Invalid command (directory traversal detected).\x1b[0m\r\n';
        try {
            ws.send(JSON.stringify({ type: 'stdout', data: errorMsg }));
        } catch(e) {}
        return;
      }
      
      const commandParts = parsedMessage.command.split(' ');
      const cmd = commandParts[0];
      const args = commandParts.slice(1);
      
      const executionCwd = PROJECT_ROOT_TMP_DIR;

      console.log(`Spawning PTY with command: '${cmd}' and args: [${args.join(', ')}] in CWD: ${executionCwd}`);
      
      try {
        ptyProcess = pty.spawn(cmd, args, {
          name: 'xterm-color',
          cols: parsedMessage.cols || 80,
          rows: parsedMessage.rows || 24,
          cwd: executionCwd,
          env: process.env,
        });

        // Pipe PTY output to WebSocket
        ptyProcess.onData(data => {
          try {
            ws.send(JSON.stringify({ type: 'stdout', data }));
          } catch (e) {
            // This can happen if the client disconnects abruptly.
          }
        });

        ptyProcess.on('exit', ({ exitCode, signal }) => {
          console.log(`PTY process exited with code ${exitCode}, signal ${signal}`);
          try {
            ws.send(JSON.stringify({ type: 'exit', code: exitCode }));
          } catch (e) {
             // This can happen if the client disconnects abruptly.
          }
          ptyProcess = null;
        });

      } catch (e) {
        const errorMsg = `\r\n\x1b[31mServer Error: Failed to spawn PTY process. ${e.message}\x1b[0m\r\n`;
        console.error(errorMsg);
        try {
            ws.send(JSON.stringify({ type: 'stdout', data: errorMsg }));
            ws.send(JSON.stringify({ type: 'exit', code: 1 }));
        } catch(wsErr) {}
        ptyProcess = null;
      }

    } else if (parsedMessage.type === 'stdin' && ptyProcess) {
        ptyProcess.write(parsedMessage.data);
    } else if (parsedMessage.type === 'resize' && ptyProcess) {
        ptyProcess.resize(parsedMessage.cols, parsedMessage.rows);
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    if (ptyProcess) {
      console.log('Terminating PTY process due to client disconnect.');
      ptyProcess.kill();
      ptyProcess = null;
    }
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    if (ptyProcess) {
        ptyProcess.kill();
        ptyProcess = null;
    }
  });
});