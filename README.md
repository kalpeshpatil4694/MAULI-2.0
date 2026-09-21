# Chess Game Server

A simple chess game server with move validation and error handling.

## Getting Started

1. Install dependencies: `npm install`
2. Start the server: `npm start`
3. Make a move: `curl -X POST -H "Content-Type: application/json" -d '{"start":"e2","end":"e4"}' http://localhost:3000/move`
4. Get the current board: `curl http://localhost:3000/board`
