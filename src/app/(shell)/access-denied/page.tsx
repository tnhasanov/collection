import { Callout } from "@/components/ui";
import { PageHeader } from "@/components/ui/PageHeader";

export default function AccessDenied() {
  return (
    <>
      <PageHeader kicker="Access" title="Permission denied" />
      <Callout tone="danger">You do not have permission to view this page or record. Access is enforced on the server; a hidden menu is never authorization.</Callout>
    </>
  );
}
