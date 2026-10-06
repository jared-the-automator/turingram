import React, { useState } from 'react';
import { MeetingProvider } from './contexts/MeetingContext';
import { SettingsProvider } from './contexts/SettingsContext';
import MeetingList from './screens/MeetingList';
import ActiveRecording from './screens/ActiveRecording';
import TranscriptView from './screens/TranscriptView';
import SpeakerAssignment from './screens/SpeakerAssignment';
import Settings from './screens/Settings';
import MeetingToast from './components/MeetingToast';
import ConsentModal from './components/ConsentModal';
import { DrinkNag } from './components/Drinks';

export type Screen =
  | { name: 'list' }
  | { name: 'recording' }
  | { name: 'speakers'; meetingId: string }
  | { name: 'transcript'; meetingId: string }
  | { name: 'settings' }

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'list' });
  const navigate = (s: Screen) => setScreen(s);

  return (
    <SettingsProvider>
      <MeetingProvider>
        {screen.name === 'list' && <MeetingList onNavigate={navigate} />}
        {screen.name === 'recording' && <ActiveRecording onNavigate={navigate} />}
        {screen.name === 'speakers' && <SpeakerAssignment meetingId={screen.meetingId} onNavigate={navigate} />}
        {screen.name === 'transcript' && <TranscriptView meetingId={screen.meetingId} onNavigate={navigate} />}
        {screen.name === 'settings' && <Settings onNavigate={navigate} />}
        <MeetingToast onNavigate={navigate} />
        <DrinkNag onNavigate={navigate} />
        <ConsentModal />
      </MeetingProvider>
    </SettingsProvider>
  );
}
