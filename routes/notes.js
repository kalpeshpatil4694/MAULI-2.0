const express = require('express');
const router = express.Router();
const Note = require('../models/Note');

router.get('/', async (req, res) => {
  try {
    const notes = await Note.find();
    res.send(notes);
  } catch (err) {
    console.log('Error:', err);
    res.status(500).send({ message: 'Error fetching notes' });
  }
});

router.post('/', async (req, res) => {
  try {
    const note = new Note(req.body);
    await note.save();
    res.send(note);
  } catch (err) {
    console.log('Error:', err);
    res.status(500).send({ message: 'Error creating note' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const note = await Note.findById(req.params.id);
    if (!note) {
      res.status(404).send({ message: 'Note not found' });
    } else {
      res.send(note);
    }
  } catch (err) {
    console.log('Error:', err);
    res.status(500).send({ message: 'Error fetching note' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const note = await Note.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!note) {
      res.status(404).send({ message: 'Note not found' });
    } else {
      res.send(note);
    }
  } catch (err) {
    console.log('Error:', err);
    res.status(500).send({ message: 'Error updating note' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await Note.findByIdAndRemove(req.params.id);
    res.send({ message: 'Note deleted' });
  } catch (err) {
    console.log('Error:', err);
    res.status(500).send({ message: 'Error deleting note' });
  }
});

module.exports = router;
