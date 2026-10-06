import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { AppSettings, AudioDevice } from '@turingyde/transcript-core';

interface SettingsContextValue {
  settings: AppSettings | null
  audioDevices: AudioDevice[]
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [audioDevices, setAudioDevices] = useState<AudioDevice[]>([]);

  useEffect(() => {
    window.api.getSettings().then(setSettings);
    window.api.getAudioDevices().then(setAudioDevices);
  }, []);

  // Drive the light/dark palette off the root's data-theme; index.css overrides
  // the color tokens under [data-theme="light"]. Default dark until settings load.
  useEffect(() => {
    document.documentElement.dataset.theme = settings?.theme ?? 'dark';
  }, [settings?.theme]);

  const updateSettings = useCallback(async (patch: Partial<AppSettings>) => {
    if (!settings) return;
    const updated = { ...settings, ...patch };
    await window.api.updateSettings(patch);
    setSettings(updated);
  }, [settings]);

  return (
    <SettingsContext.Provider value={{ settings, audioDevices, updateSettings }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be inside SettingsProvider');
  return ctx;
}
