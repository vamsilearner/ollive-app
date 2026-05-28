"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { SessionSidebar } from "@/components/chat/SessionSidebar";
import { ChatWindow } from "@/components/chat/ChatWindow";
import { InputBar } from "@/components/chat/InputBar";
import { Message } from "@/src/types";

interface Session {
  id: string;
  title: string;
  status: "active" | "cancelled" | "completed";
  createdAt: string;
  updatedAt: string;
}

export default function ChatPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSession, setActiveSession] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const [provider, setProvider] = useState<string>("");

  // Load sessions
  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/sessions");
      const data = await res.json();
      setSessions(data.sessions || []);
    } catch (error) {
      console.error("Failed to load sessions:", error);
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // Load session messages
  const loadSession = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch(`/api/sessions/${sessionId}`);
      const data = await res.json();
      if (data.messages) {
        setMessages(
          data.messages.map((m: any) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            createdAt: m.createdAt ? new Date(m.createdAt) : undefined,
          })),
        );
      }
      setActiveSession(sessionId);
    } catch (error) {
      console.error("Failed to load session:", error);
    }
  }, []);

  // Create new session
  const createNewSession = useCallback(async () => {
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "New Conversation" }),
      });
      const data = await res.json();
      if (data.session) {
        setSessions((prev) => [data.session, ...prev]);
        setActiveSession(data.session.id);
        setMessages([]);
      }
    } catch (error) {
      console.error("Failed to create session:", error);
    }
  }, []);

  // Cancel session
  const cancelSession = useCallback(
    async (sessionId: string) => {
      try {
        await fetch(`/api/sessions/${sessionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "cancel" }),
        });
        setSessions((prev) =>
          prev.map((s) =>
            s.id === sessionId ? { ...s, status: "cancelled" as const } : s,
          ),
        );
        if (activeSession === sessionId) {
          setActiveSession(null);
          setMessages([]);
        }
      } catch (error) {
        console.error("Failed to cancel session:", error);
      }
    },
    [activeSession],
  );

  // Send message
  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() || isStreaming) return;

      setIsLoading(true);
      setIsStreaming(true);

      const userMessage: Message = { role: "user", content };
      const currentSessionId = activeSession;

      // Snapshot history array inside state updater to pull 'messages' out of useCallback dependencies
      let currentHistory: Message[] = [];
      setMessages((prev) => {
        currentHistory = prev.slice(-10);
        return [...prev, userMessage];
      });

      const abortController = new AbortController();
      abortRef.current = abortController;

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: content,
            sessionId: currentSessionId,
            history: currentHistory,
          }),
          signal: abortController.signal,
        });

        if (!response.ok) {
          throw new Error(`API error: ${response.status}`);
        }

        const newSessionId = response.headers.get("X-Session-Id");
        if (newSessionId && !currentSessionId) {
          setActiveSession(newSessionId);
          loadSessions();
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");

        // Setup a placeholder for the incoming assistant response
        setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

        const decoder = new TextDecoder("utf-8");
        let assistantContent = "";
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          // Safely buffer raw text chunks across transmission pipelines
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine) continue;

            let textChunk = "";

            // Option A: Handle Server-Sent Events (SSE format)
            if (trimmedLine.startsWith("data:")) {
              const dataContent = trimmedLine.replace(/^data:\s*/, "");
              if (dataContent === "[DONE]") continue;

              try {
                const parsed = JSON.parse(dataContent);
                textChunk =
                  parsed.text || parsed.content || parsed.message || "";
              } catch {
                textChunk = dataContent;
              }
            }
            // Option B: Handle Vercel AI SDK text protocol blocks (e.g. 0:"text")
            else if (/^\d+:"/.test(trimmedLine)) {
              try {
                const match = trimmedLine.match(/^\d+:"(.*)"$/);
                if (match) {
                  textChunk = JSON.parse(`"${match[1]}"`);
                }
              } catch {
                textChunk = trimmedLine;
              }
            }
            // Option C: Handle completely raw data sequences
            else {
              textChunk = trimmedLine;
            }

            if (textChunk) {
              assistantContent += textChunk;

              // Target state updates securely via an internal shallow clone
              setMessages((prev) => {
                if (prev.length === 0) return prev;
                const updated = [...prev];
                const lastIdx = updated.length - 1;
                updated[lastIdx] = {
                  ...updated[lastIdx],
                  content: assistantContent,
                };
                return updated;
              });
            }
          }
        }

        // Check if any leftover trail remains in line buffer after read ends
        if (buffer) {
          let finalChunk = buffer.trim();
          if (finalChunk.startsWith("data:")) {
            finalChunk = finalChunk.replace(/^data:\s*/, "");
          }
          if (finalChunk && finalChunk !== "[DONE]") {
            assistantContent += finalChunk;
            setMessages((prev) => {
              if (prev.length === 0) return prev;
              const updated = [...prev];
              const lastIdx = updated.length - 1;
              updated[lastIdx] = {
                ...updated[lastIdx],
                content: assistantContent,
              };
              return updated;
            });
          }
        }
      } catch (error: any) {
        if (error.name === "AbortError") {
          console.log("Stream cancelled");
        } else {
          console.error("Chat error:", error);
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: `Error: ${error.message || "Failed to get response"}`,
            },
          ]);
        }
      } finally {
        setIsLoading(false);
        setIsStreaming(false);
        abortRef.current = null;
        loadSessions();
      }
    },
    [activeSession, isStreaming, loadSessions],
  );

  // Cancel streaming
  const cancelStreaming = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
  }, []);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <div
        className={`${sidebarOpen ? "w-72" : "w-0"} transition-all duration-200 overflow-hidden bg-gray-100 border-r border-gray-200 flex-shrink-0`}
      >
        <SessionSidebar
          sessions={sessions}
          activeSession={activeSession}
          onSelectSession={loadSession}
          onNewSession={createNewSession}
          onCancelSession={cancelSession}
        />
      </div>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 bg-white">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
          </button>
          <h1 className="text-lg font-semibold text-gray-800">Ollive Chat</h1>
          <a
            href="/dashboard"
            className="ml-auto text-sm text-blue-600 hover:text-blue-800"
          >
            Dashboard
          </a>
        </div>

        {/* Chat messages */}
        <ChatWindow messages={messages} isLoading={isLoading} />

        {/* Input */}
        <InputBar
          onSend={sendMessage}
          onCancel={cancelStreaming}
          isLoading={isLoading}
          isStreaming={isStreaming}
        />
      </div>
    </div>
  );
}
