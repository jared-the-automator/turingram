import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/space-grotesk/300.css';
import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/600.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/audiowide';
import './index.css';
import App from './App';

createRoot(document.getElementById('root')!).render(<App />);
