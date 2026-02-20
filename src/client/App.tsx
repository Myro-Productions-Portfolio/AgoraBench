import { useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import { useAuth } from '@clerk/clerk-react';
import { Layout } from './components/Layout';
import { DashboardPage } from './pages/DashboardPage';
import { LegislationPage } from './pages/LegislationPage';
import { ElectionsPage } from './pages/ElectionsPage';
import { PartiesPage } from './pages/PartiesPage';
import { AgentProfilePage } from './pages/AgentProfilePage';
import { AgentsDirectoryPage } from './pages/AgentsDirectoryPage';
import { CapitolMapPage } from './pages/CapitolMapPage';
import { BuildingInteriorPage } from './pages/BuildingInteriorPage';
import { AdminPage } from './pages/AdminPage';
import { CalendarPage } from './pages/CalendarPage';
import { ProfilePage } from './pages/ProfilePage';
import { ForumPage } from './pages/ForumPage';
import { ThreadPage } from './pages/ThreadPage';
import { BillDetailPage } from './pages/BillDetailPage';
import { PartyDetailPage } from './pages/PartyDetailPage';
import { ElectionDetailPage } from './pages/ElectionDetailPage';
import { LawsPage } from './pages/LawsPage';
import { LawDetailPage } from './pages/LawDetailPage';
import { CourtPage } from './pages/CourtPage';
import { CasePage } from './pages/CasePage';
import { ObserverPage } from './pages/ObserverPage';
import { TrainingPage } from './pages/TrainingPage';
import { ResearcherPage } from './pages/ResearcherPage';
import { setTokenProvider } from './lib/api';

export function App() {
  const { getToken } = useAuth();

  // Wire Clerk's session token into every API request
  useEffect(() => {
    setTokenProvider(() => getToken());
  }, [getToken]);

  return (
    <Routes>
      <Route path="/observe" element={<ObserverPage />} />
      <Route element={<Layout />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/legislation" element={<LegislationPage />} />
        <Route path="/legislation/:id" element={<BillDetailPage />} />
        <Route path="/laws" element={<LawsPage />} />
        <Route path="/laws/:id" element={<LawDetailPage />} />
        <Route path="/court" element={<CourtPage />} />
        <Route path="/court/cases/:id" element={<CasePage />} />
        <Route path="/elections" element={<ElectionsPage />} />
        <Route path="/elections/:id" element={<ElectionDetailPage />} />
        <Route path="/parties" element={<PartiesPage />} />
        <Route path="/parties/:id" element={<PartyDetailPage />} />
        <Route path="/agents" element={<AgentsDirectoryPage />} />
        <Route path="/agents/:id" element={<AgentProfilePage />} />
        <Route path="/capitol-map" element={<CapitolMapPage />} />
        <Route path="/capitol-map/:buildingId" element={<BuildingInteriorPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/forum" element={<ForumPage />} />
        <Route path="/forum/:threadId" element={<ThreadPage />} />
        <Route path="/training" element={<TrainingPage />} />
        <Route path="/researcher" element={<ResearcherPage />} />
      </Route>
    </Routes>
  );
}
