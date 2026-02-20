import { useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import { useAuth } from '@clerk/clerk-react';
import { Layout } from './components/Layout';
import { DashboardPage } from './pages/DashboardPage';
import { LegislationPage } from '../modules/legislation/client/pages/LegislationPage';
import { ElectionsPage } from '../modules/elections/client/pages/ElectionsPage';
import { PartiesPage } from '../modules/elections/client/pages/PartiesPage';
import { AgentProfilePage } from './pages/AgentProfilePage';
import { AgentsDirectoryPage } from './pages/AgentsDirectoryPage';
import { CapitolMapPage } from './pages/CapitolMapPage';
import { BuildingInteriorPage } from './pages/BuildingInteriorPage';
import { AdminPage } from './pages/AdminPage';
import { CalendarPage } from './pages/CalendarPage';
import { ProfilePage } from './pages/ProfilePage';
import { ForumPage } from '../modules/forum/client/pages/ForumPage';
import { ThreadPage } from '../modules/forum/client/pages/ThreadPage';
import { BillDetailPage } from '../modules/legislation/client/pages/BillDetailPage';
import { PartyDetailPage } from '../modules/elections/client/pages/PartyDetailPage';
import { ElectionDetailPage } from '../modules/elections/client/pages/ElectionDetailPage';
import { LawsPage } from '../modules/legislation/client/pages/LawsPage';
import { LawDetailPage } from '../modules/legislation/client/pages/LawDetailPage';
import { CourtPage } from '../modules/legislation/client/pages/CourtPage';
import { CasePage } from '../modules/legislation/client/pages/CasePage';
import { ObserverPage } from './pages/ObserverPage';
import { TrainingPage } from '../modules/benchmark/client/pages/TrainingPage';
import { ResearcherPage } from './pages/ResearcherPage';
import { BenchmarkPage } from '../modules/benchmark/client/pages/BenchmarkPage';
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
        <Route path="/benchmark" element={<BenchmarkPage />} />
        <Route path="/researcher" element={<ResearcherPage />} />
      </Route>
    </Routes>
  );
}
