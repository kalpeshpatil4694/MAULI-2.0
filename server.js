const express = require('express');
const app = express();
const mongoose = require('mongoose');
const noteRouter = require('./routes/notes');
const cors = require('cors');

app.use(express.json());
app.use(cors());

mongoose.connect('mongodb://localhost:27017/notes', { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('Connected to MongoDB'))
  .catch((err) => console.log('Error connecting to MongoDB:', err));

app.use('/notes', noteRouter);

app.use((err, req, res, next) => {
  console.log('Error:', err);
  res.status(500).send({ message: 'Internal Server Error' });
});

const port = 3000;
app.listen(port, () => console.log(`Server listening on port ${port}`));
