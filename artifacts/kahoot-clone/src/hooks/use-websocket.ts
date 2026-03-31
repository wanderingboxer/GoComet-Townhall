import { useState, useEffect, useRef, useCallback } from "react";
import { z } from "zod";

// Validates incoming WS messages to ensure frontend doesn't crash on bad data
const BaseMessageSchema = z.object({
  type: z.string(),
  payload: z.any().optional(),
});

type WebSocketMessage = z.infer<typeof BaseMessageSchema>;

export function useGameWebSocket() {
  const [connected, setConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | undefined>(undefined);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    // Use backend API origin for WebSocket connection
    const configuredApiOrigin = import.meta.env.VITE_API_ORIGIN?.trim();
    const wsOrigin = configuredApiOrigin || window.location.origin;
    
    let wsUrl: string;
    if (configuredApiOrigin) {
      // Use configured backend URL
      wsUrl = configuredApiOrigin.replace(/^https?/, 'wss').replace(/^http?/, 'ws') + '/api/ws';
    } else {
      // Fallback to current host (development)
      const apiUrl = new URL(window.location.origin);
      const wsProtocol = apiUrl.protocol === "https:" ? "wss:" : "ws:";
      wsUrl = `${wsProtocol}//${apiUrl.host}/api/ws`;
    }

    console.log("[WS] Connecting to:", wsUrl);

    try {
      const socket = new WebSocket(wsUrl);
      
      socket.onopen = () => {
        console.log("[WS] Connected");
        setConnected(true);
      };

      socket.onclose = () => {
        console.log("[WS] Disconnected");
        setConnected(false);
        // Auto-reconnect after 2 seconds
        reconnectTimeoutRef.current = window.setTimeout(connect, 2000);
      };

      socket.onmessage = (event) => {
        try {
          const raw = JSON.parse(event.data);
          const parsed = BaseMessageSchema.safeParse(raw);
          if (parsed.success) {
            setLastMessage(parsed.data);
          } else {
            console.error("[WS] Invalid message format", parsed.error);
          }
        } catch (err) {
          console.error("[WS] Failed to parse message", err);
        }
      };

      wsRef.current = socket;
    } catch (err) {
      console.error("[WS] Connection failed", err);
    }
  }, []);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimeoutRef.current);
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  const emit = useCallback((type: string, payload?: any) => {
    console.log("[WS] Emit attempt", { type, payload, readyState: wsRef.current?.readyState });
    
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const message = JSON.stringify({ type, payload });
      console.log("[WS] Sending message:", message);
      wsRef.current.send(message);
    } else {
      console.warn("[WS] Cannot emit, socket not connected", { 
        type, 
        readyState: wsRef.current?.readyState,
        state: wsRef.current?.readyState === WebSocket.OPEN ? 'OPEN' : 'NOT OPEN'
      });
    }
  }, []);

  return { connected, lastMessage, emit };
}
