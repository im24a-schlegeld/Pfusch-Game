import React from 'react';
import { createRoot } from 'react-dom/client';
import GameApp from './ui/GameApp';
import './globals.css';
import './preview.css';
import './pfusch-shop-ui.css';
import './ride-update-v38.css';
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <GameApp />
  </React.StrictMode>,
);

import './refinement-v40.css';
