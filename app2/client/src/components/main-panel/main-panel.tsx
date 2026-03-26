import { useUIStore } from '@/stores/ui-store';
import { ScopeBar } from './scope-bar';
import { EventFilterBar } from './event-filter-bar';
import { EventStream } from '@/components/event-stream/event-stream';

export function MainPanel() {
  const { selectedProjectId } = useUIStore();

  if (!selectedProjectId) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        Select a project to get started
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <ScopeBar />
      <EventFilterBar />
      {/* ActivityTimeline will be inserted here in Task 11 */}
      <EventStream />
    </div>
  );
}
