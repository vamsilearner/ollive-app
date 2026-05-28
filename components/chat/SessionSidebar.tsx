'use client';

interface Session {
  id: string;
  title: string;
  status: 'active' | 'cancelled' | 'completed';
  createdAt: string;
  updatedAt: string;
}

interface SessionSidebarProps {
  sessions: Session[];
  activeSession: string | null;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onCancelSession: (id: string) => void;
}

export function SessionSidebar({
  sessions,
  activeSession,
  onSelectSession,
  onNewSession,
  onCancelSession,
}: SessionSidebarProps) {
  return (
    <div className="flex flex-col h-full">
      {/* New chat button */}
      <div className="p-3 border-b border-gray-200">
        <button
          onClick={onNewSession}
          className="w-full flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Chat
        </button>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {sessions.length === 0 && (
          <p className="text-sm text-gray-500 text-center py-4">No conversations yet</p>
        )}

        {sessions.map(session => (
          <div
            key={session.id}
            className={`group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
              session.id === activeSession
                ? 'bg-blue-100 text-blue-800'
                : 'hover:bg-gray-200 text-gray-700'
            } ${session.status === 'cancelled' ? 'opacity-50' : ''}`}
            onClick={() => session.status !== 'cancelled' && onSelectSession(session.id)}
          >
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <span className="flex-1 text-sm truncate">{session.title}</span>
            {session.status === 'active' && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCancelSession(session.id);
                }}
                className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-100 rounded transition-opacity"
                title="Cancel session"
              >
                <svg className="w-3 h-3 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
            {session.status === 'cancelled' && (
              <span className="text-xs text-red-500">Cancelled</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
