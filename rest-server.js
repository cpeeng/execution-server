const express = require('express');
const fs = require('fs');
const { exec } = require('child_process');
const path = require('path');

const app = express();
app.use(express.json());

const TMP_DIR = path.resolve(process.cwd(), 'tmp');
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR);

// Run Python code
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

// Run C++ code
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`REST execution server running on port ${PORT}`);
});
