import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { CallOverlayPage } from './pages/CallOverlayPage';
import './index.css';

const isOverlayRoute =
  window.location.pathname === '/call-overlay' ||
  window.location.pathname.startsWith('/call-overlay') ||
  window.location.hash.startsWith('#/call-overlay');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isOverlayRoute ? <CallOverlayPage /> : <App />}
  </React.StrictMode>
);
