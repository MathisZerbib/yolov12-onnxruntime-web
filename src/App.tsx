import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import LiveTrafficGame from '@/pages/LiveTrafficGame';
import RoomPage from '@/pages/RoomPage';
import './globals.css';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LiveTrafficGame />} />
        <Route path="/traffic" element={<Navigate to="/" replace />} />
        <Route path="/room/:roomId" element={<RoomPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;