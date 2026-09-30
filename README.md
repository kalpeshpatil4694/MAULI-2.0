# To-Do List App

A simple to-do list web application with REST API endpoints.

## Endpoints
- `GET /tasks` - Get all tasks
- `POST /tasks` - Create new task (requires {"text": "string"})
- `PUT /tasks/:id` - Update task completion status (requires {"completed": boolean})
- `DELETE /tasks/:id` - Delete task

## Usage
1. Install dependencies: `npm install`
2. Start server: `npm start`