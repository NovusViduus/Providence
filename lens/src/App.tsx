import { Routes, Route, Navigate } from 'react-router-dom';
import { getToken } from './services/auth';
import Layout from './components/Layout';
import Login from './components/Login';
import AttackFeed from './components/AttackFeed';
import ResponseLog from './components/ResponseLog';
import ManualOverride from './components/ManualOverride';
import ThreatMap from './components/ThreatMap';
import TimelapseGlobe from './components/TimelapseGlobe';
import Codex from './components/Codex';
import About from './components/About';
import PlaybookEditor from './components/PlaybookEditor';
import EventDetail from './components/EventDetail';
import IncidentDetail from './components/IncidentDetail';
import Dossier from './components/Dossier';
import AttackerList from './components/AttackerList';
import BehaviorClusters from './components/BehaviorClusters';
import SessionReplays from './components/SessionReplays';
import NetworkTopology from './components/NetworkTopology';
import ThreatBriefing from './components/ThreatBriefing';
import CommandHeatmap from './components/CommandHeatmap';
import ReportGenerator from './components/ReportGenerator';
import ModelMetrics from './components/ModelMetrics';
import NewsFeed from './components/NewsFeed';
import TechStack from './components/TechStack';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  return getToken() ? <>{children}</> : <Navigate to="/login" />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index element={<ModelMetrics />} />
        <Route path="events" element={<AttackFeed />} />
        <Route path="events/:id" element={<EventDetail />} />
        <Route path="incidents" element={<ManualOverride />} />
        <Route path="incidents/:id" element={<IncidentDetail />} />
        <Route path="dossier/:ip" element={<Dossier />} />
        <Route path="attackers" element={<AttackerList />} />
        <Route path="clusters" element={<BehaviorClusters />} />
        <Route path="sessions" element={<SessionReplays />} />
        <Route path="topology" element={<NetworkTopology />} />
        <Route path="briefing" element={<ThreatBriefing />} />
        <Route path="heatmap" element={<CommandHeatmap />} />
        <Route path="reports" element={<ReportGenerator />} />
        <Route path="responses" element={<ResponseLog />} />
        <Route path="threats" element={<ThreatMap />} />
        <Route path="timelapse" element={<TimelapseGlobe />} />
        <Route path="codex" element={<Codex />} />
        <Route path="about" element={<About />} />
        <Route path="playbooks" element={<PlaybookEditor />} />
        <Route path="news" element={<NewsFeed />} />
        <Route path="stack" element={<TechStack />} />
      </Route>
    </Routes>
  );
}
