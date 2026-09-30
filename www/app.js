let todos = JSON.parse(localStorage.getItem('todos') || '[]');

function render() {
  const list = document.getElementById('todoList');
  list.innerHTML = todos.map((todo, index) => {
    return `<li class="${todo.completed ? 'completed' : ''}">
      <span onclick="toggleTodo(${index})">${todo.text}</span>
      <button onclick="deleteTodo(${index})">✖</button>
    </li>`;
  }).join('');
}

function addTodo() {
  const input = document.getElementById('todoInput');
  const text = input.value.trim();
  if (text === '') return;
  todos.push({ text, completed: false });
  input.value = '';
  render();
  saveTodos();
}

function toggleTodo(index) {
  todos[index].completed = !todos[index].completed;
  render();
  saveTodos();
}

function deleteTodo(index) {
  todos.splice(index, 1);
  render();
  saveTodos();
}

function saveTodos() {
  localStorage.setItem('todos', JSON.stringify(todos));
}

// Initial render
render();