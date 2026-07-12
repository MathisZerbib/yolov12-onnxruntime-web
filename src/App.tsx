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
const AdminPage = lazy(() => import('@/pages/AdminPage'));
const AdminContractsPage = lazy(() => import('@/pages/AdminContractsPage'));
const AdminExplorerPage = lazy(() => import('@/pages/AdminExplorerPage'));

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
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/admin/contracts" element={<AdminContractsPage />} />
        <Route path="/admin/explorer" element={<AdminExplorerPage />} />
      </Routes></Suspense>
    </BrowserRouter>
  );
}

export default App;
