const express = require('express');
const app = express();
const port = 3000;

app.use(express.json());

let board = [];
let turn = 'white';

// Initialize the board
for (let i = 0; i < 8; i++) {
  board[i] = [];
  for (let j = 0; j < 8; j++) {
    if (i === 1) {
      board[i][j] = 'bp';
    } else if (i === 6) {
      board[i][j] = 'wp';
    } else if (i === 0) {
      if (j === 0 || j === 7) {
        board[i][j] = 'br';
      } else if (j === 1 || j === 6) {
        board[i][j] = 'bn';
      } else if (j === 2 || j === 5) {
        board[i][j] = 'bb';
      } else if (j === 3) {
        board[i][j] = 'bq';
      } else if (j === 4) {
        board[i][j] = 'bk';
      }
    } else if (i === 7) {
      if (j === 0 || j === 7) {
        board[i][j] = 'wr';
      } else if (j === 1 || j === 6) {
        board[i][j] = 'wn';
      } else if (j === 2 || j === 5) {
        board[i][j] = 'wb';
      } else if (j === 3) {
        board[i][j] = 'wq';
      } else if (j === 4) {
        board[i][j] = 'wk';
      }
    } else {
      board[i][j] = '';
    }
  }
}

// Function to validate a move
function validateMove(start, end) {
  const startX = start.charCodeAt(0) - 97;
  const startY = 8 - parseInt(start.charAt(1));
  const endX = end.charCodeAt(0) - 97;
  const endY = 8 - parseInt(end.charAt(1));

  if (board[startY][startX] === '') {
    return { valid: false, message: 'No piece at start position' };
  }

  if (board[endY][endX] !== '' && board[endY][endX].charAt(0) === turn) {
    return { valid: false, message: 'Cannot capture own piece' };
  }

  // Simple move validation for pawns
  if (board[startY][startX].charAt(1) === 'p') {
    if (turn === 'white') {
      if (startY === 6 && endY === 4 && startX === endX) {
        return { valid: true };
      } else if (endY === startY - 1 && Math.abs(endX - startX) === 1) {
        return { valid: true };
      } else if (endY === startY - 1 && startX === endX) {
        return { valid: true };
      }
    } else {
      if (startY === 1 && endY === 3 && startX === endX) {
        return { valid: true };
      } else if (endY === startY + 1 && Math.abs(endX - startX) === 1) {
        return { valid: true };
      } else if (endY === startY + 1 && startX === endX) {
        return { valid: true };
      }
    }
  }

  // Simple move validation for knights
  if (board[startY][startX].charAt(1) === 'n') {
    if (Math.abs(endX - startX) === 2 && Math.abs(endY - startY) === 1) {
      return { valid: true };
    } else if (Math.abs(endX - startX) === 1 && Math.abs(endY - startY) === 2) {
      return { valid: true };
    }
  }

  return { valid: false, message: 'Invalid move' };
}

app.post('/move', (req, res) => {
  const start = req.body.start;
  const end = req.body.end;

  const result = validateMove(start, end);

  if (result.valid) {
    const piece = board[8 - parseInt(start.charAt(1))][start.charCodeAt(0) - 97];
    board[8 - parseInt(start.charAt(1))][start.charCodeAt(0) - 97] = '';
    board[8 - parseInt(end.charAt(1))][end.charCodeAt(0) - 97] = piece;
    turn = turn === 'white' ? 'black' : 'white';
    res.json({ message: 'Move successful' });
  } else {
    res.status(400).json({ message: result.message });
  }
});

app.get('/board', (req, res) => {
  res.json(board);
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
