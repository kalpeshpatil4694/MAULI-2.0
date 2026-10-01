let currentInput = '0';
let previousInput = '';
let operation = null;

function updateDisplay() {
  document.getElementById('display').textContent = currentInput;
}

function appendValue(value) {
  if (currentInput === '0' && value !== '.') {
    currentInput = value;
  } else {
    currentInput += value;
  }
  updateDisplay();
}

function clearDisplay() {
  currentInput = '0';
  previousInput = '';
  operation = null;
  updateDisplay();
}

function chooseOperation(newOperation) {
  if (currentInput === '') return;
  if (previousInput !== '') {
    calculate();
  }
  operation = newOperation;
  previousInput = currentInput;
  currentInput = '';
}

function calculate() {
  if (previousInput === '' || currentInput === '' || operation === null) return;

  let result;
  const prev = parseFloat(previousInput);
  const current = parseFloat(currentInput);

  switch (operation) {
    case '+':
      result = prev + current;
      break;
    case '-':
      result = prev - current;
      break;
    case '*':
      result = prev * current;
      break;
    case '/':
      result = prev / current;
      break;
    case '%':
      result = prev % current;
      break;
    default:
      return;
  }

  currentInput = result.toString();
  operation = null;
  previousInput = '';
  updateDisplay();
}

updateDisplay();