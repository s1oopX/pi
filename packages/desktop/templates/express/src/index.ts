import express from "express";

const app = express();
const PORT = process.env.PORT ?? 3000;

app.get("/", (_req, res) => {
  res.json({ message: "Welcome to Pi Studio Dev" });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
