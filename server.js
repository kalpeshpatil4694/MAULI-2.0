const express = require('express');
const app = express();
const port = 3000;

app.use(express.json());

let board = [
  ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'],
  ['P', 'P', 'P', 'P', 'P', 'P', 'P', 'P'],
  [' ', ' ', ' ', ' ', ' ', ' ', ' ', ' '],
  [' ', ' ', ' ', ' ', ' ', ' ', ' ', ' '],
  [' ', ' ', ' ', ' ', ' ', ' ', ' ', ' '],
  [' ', ' ', ' ', ' ', ' ', ' ', ' ', ' '],
  ['p', 'p', 'p', 'p', 'p', 'p', 'p', 'p'],
  ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r']
];

app.get('/board', (req, res) => {
  res.json(board);
});

app.post('/move', (req, res) => {
  const { from, to } = req.body;
  if (!from || !to) {
    res.status(400).json({ error: 'Invalid move' });
    return;
  }
  const fromPiece = board[from[0]][from[1]];
  const toPiece = board[to[0]][to[1]];
  if (fromPiece === ' ') {
    res.status(400).json({ error: 'No piece to move' });
    return;
  }
  if (toPiece !== ' ' && fromPiece.toLowerCase() === toPiece.toLowerCase()) {
    res.status(400).json({ error: 'Cannot capture own piece' });
    return;
  }
  board[to[0]][to[1]] = fromPiece;
  board[from[0]][from[1]] = ' ';
  res.json(board);
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
