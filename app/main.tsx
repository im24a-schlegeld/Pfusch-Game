import React from 'react';
import { createRoot } from 'react-dom/client';
import GameApp from './ui/GameApp';
import './globals.css';
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <GameApp />
  </React.StrictMode>,
);
