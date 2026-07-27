import { DurableApprovalBanner } from "@/components/DurableApprovalBanner";
import { DurableMissionAuthority } from "@/components/DurableMissionAuthority";
import { WorkspaceShell } from "@/components/WorkspaceShell";

export default function Home() {
  return (
    <DurableMissionAuthority>
      <DurableApprovalBanner />
      <WorkspaceShell />
    </DurableMissionAuthority>
  );
}
