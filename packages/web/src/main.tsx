import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import RecapApp from './RecapApp';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element not found');
}

const isRecap = window.location.pathname.startsWith('/recap');

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>{isRecap ? <RecapApp /> : <App />}</ErrorBoundary>
  </StrictMode>,
);
