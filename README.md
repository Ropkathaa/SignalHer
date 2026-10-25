# SignalHer
A web-based safety-support application with a frontend and Python/Flask backend for message analysis, timeline review, and safety resources.

## Key Features

- **Message Analysis:** Analyse a user-provided message and review the resulting findings.
- **Evidence-Based Findings:** View the analysis results, supporting evidence, explanations, and suggested actions.
- **Incident Timeline Review:** Review incident-specific observations, checks performed, and practical next steps.
- **Safety Resources:** Explore resources relevant to different online safety concerns.
- **Safety Search:** Access category-based searches for online safety information and support.
- **Emergency Information:** Find India's emergency guidance and the official helpline directory.

## Technology Stack

### Frontend
- HTML5
- CSS3
- JavaScript

### Backend
- Python
- Flask
- Jupyter Notebook for backend development and execution

### Integrations
- Google Programmable Search integration for safety-related searches.

## Project Structure

The repository contains two main components:

- **Frontend:** The website interface, styling, navigation, and client-side interactions.
- **Backend:** The Python-based API responsible for processing analysis requests, returning findings, preparing timeline reviews, and providing safety-related data.

The frontend communicates with the backend through HTTP API endpoints.

## Running SignalHer Locally

SignalHer currently uses a local development setup. The frontend and backend must both be running for the complete application workflow to function.

### 1. Start the Backend

1. Open the project in Jupyter Notebook.
2. Open the backend notebook, `01_backend_development.ipynb`.
3. Start the appropriate Python kernel and execute the required notebook cells in order.
4. Ensure that the Flask API starts successfully.

The backend is configured to run at:

`http://127.0.0.1:5000`

You can check backend availability at:

`http://127.0.0.1:5000/api/health`

### 2. Start the Frontend

1. Open the project folder in WebStorm.
2. Serve `index.html` using your local development server, such as the Live Server extension.
3. Open the frontend in your browser.

The current development address is:

`http://127.0.0.1:5500/index.html`

### 3. Use the Application

Keep the frontend server and backend server running while testing SignalHer.

You can then explore message analysis, findings, timeline review, safety resources, and safety search through the interface.

## Safety and Privacy

- Avoid submitting real personal, sensitive, or confidential information when testing the application.
- Verify relevant official resources before relying on them for important decisions.
- Suggested actions are informational and may not suit every situation.
- Keep API keys, credentials, access tokens, private datasets, and other sensitive information out of public repositories.

## Current Development Status

SignalHer is being developed and tested in a local environment. Publishing its source code to GitHub does not, by itself, deploy the application or make the local backend publicly accessible.

## License

A license has not yet been selected. Reuse and redistribution permissions should be specified before the project is distributed publicly.
