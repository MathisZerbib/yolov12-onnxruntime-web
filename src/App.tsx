import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import './globals.css';

const LiveTrafficGame = lazy(() => import('@/pages/LiveTrafficGame'));
const RoomPage = lazy(() => import('@/pages/RoomPage'));
const ProfilePage = lazy(() => import('@/pages/ProfilePage'));
const LeaderboardPage = lazy(() => import('@/pages/LeaderboardPage'));
const HowItWorksPage = lazy(() => import('@/pages/HowItWorksPage'));
const ActivityPage = lazy(() => import('@/pages/ActivityPage'));
const AdminZonesPage = lazy(() => import('@/pages/AdminZonesPage'));

function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<div className="route-skeleton"><span /><span /><span /></div>}><Routes>
        <Route path="/" element={<LiveTrafficGame />} />
        <Route path="/traffic" element={<Navigate to="/" replace />} />
        <Route path="/room/:roomId" element={<RoomPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/leaderboard" element={<LeaderboardPage />} />
        <Route path="/how-it-works" element={<HowItWorksPage />} />
        <Route path="/activity" element={<ActivityPage />} />
        <Route path="/admin/zones" element={<AdminZonesPage />} />
      </Routes></Suspense>
    </BrowserRouter>
  );
}

export default App;
