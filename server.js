const express = require('express');
const app = express();
app.use(express.json());

app.post('/calculate', (req, res) => {
  const { num1, num2, operation } = req.body;
  if (!num1 || !num2 || !operation) {
    return res.status(400).send('Missing parameters');
  }
  const a = parseFloat(num1);
  const b = parseFloat(num2);
  if (isNaN(a) || isNaN(b)) {
    return res.status(400).send('Invalid numbers');
  }
  let result;
  switch (operation) {
    case 'add':
      result = a + b;
      break;
    case 'subtract':
      result = a - b;
      break;
    case 'multiply':
      result = a * b;
      break;
    case 'divide':
      if (b === 0) {
        return res.status(400).send('Division by zero');
      }
      result = a / b;
      break;
    default:
      return res.status(400).send('Invalid operation');
  }
  res.json({ result });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});