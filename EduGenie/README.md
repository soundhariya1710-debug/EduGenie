# EduGenie: Google Gemini Powered Learning Assistant

An AI learning assistant for college students (Naan Mudhalvan project).
Students can ask academic questions, get simple explanations, examples, study help and generate quick MCQ quizzes.

**Stack:** HTML5, CSS3, Vanilla JavaScript · Node.js + Express · Google Gemini API (`@google/genai`) · dotenv

## Architecture

```
Student -> Frontend -> Express Backend -> Google Gemini API
                                     <-
Student <- Frontend <- Express Backend
```

The Gemini API key lives only on the backend (`.env`). The frontend never sees it.

## Project Structure

```
EduGenie/
├── public/
│   ├── index.html
│   ├── style.css
│   └── app.js
├── src/
│   └── server.js
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

## Setup (VS Code)

1. Install Node.js 18 or newer from https://nodejs.org
2. Unzip the project and open the `EduGenie` folder in VS Code (File > Open Folder).
3. Open the terminal in VS Code (Terminal > New Terminal) and run:
   ```
   npm install
   ```
4. Get a free Gemini API key at https://aistudio.google.com/apikey
5. Create your `.env` file:
   - Duplicate `.env.example` and rename the copy to `.env`
     (or run `copy .env.example .env` on Windows / `cp .env.example .env` on Mac/Linux)
   - Open `.env` and paste your key:
     ```
     GEMINI_API_KEY=your_real_key_here
     PORT=5000
     GEMINI_MODEL=gemini-2.5-flash
     ```
6. Start the app:
   ```
   npm start
   ```
7. Open http://localhost:5000 in your browser.

After editing `.env`, stop the server (Ctrl+C) and run `npm start` again.

## API Endpoints

| Method | Endpoint      | Body                                            | Description                       |
|--------|---------------|-------------------------------------------------|-----------------------------------|
| GET    | /api/health   | -                                               | Server and Gemini key status      |
| POST   | /api/ask      | `{ "question": "...", "mode": "ask" }`          | Ask a question                    |
| POST   | /api/quiz     | `{ "topic": "DBMS" }`                           | Generate a 5-question MCQ quiz    |

`mode` can be `ask`, `simple`, `example` or `study`.

## Troubleshooting

- **"API Key Missing" in the header:** the `.env` file is missing, misnamed, or the server was not restarted.
- **"Model not found":** change `GEMINI_MODEL` in `.env` to a currently available Gemini model (see https://ai.google.dev/gemini-api/docs/models).
- **Rate limit error:** the free tier has limits, so wait a minute and retry.
- **Port already in use:** change `PORT` in `.env`.

## Security

- `.env` is listed in `.gitignore`, so never commit it to GitHub.
- The API key is never placed in HTML, CSS or frontend JavaScript.
- Error messages shown to users never include secrets.
