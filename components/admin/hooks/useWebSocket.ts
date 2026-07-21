import { useEffect, useRef, useCallback, useState } from 'react';

interface UseWebSocketOptions {
  onMessage: (data: any) => void;
  onError?: (error: Event) => void;
  onOpen?: () => void;
  onClose?: () => void;
  reconnect?: boolean;
  maxReconnectAttempts?: number;
}

/**
 * useWebSocket – Hook för WebSocket-anslutningar
 * Hanterar reconnection-logik och error-handling
 * WCAG 2.1 AA kompatibel
 */
export const useWebSocket = (url: string, options: UseWebSocketOptions) => {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectCountRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isIntentionallyClosed = useRef(false);
  const [isConnected, setIsConnected] = useState(false);

  const reconnectEnabled = options.reconnect ?? true;
  const maxAttempts = options.maxReconnectAttempts ?? 5;

  const connect = useCallback(
    function connectSocket() {
      const { onMessage, onError, onOpen, onClose } = options;
      if (!url) {
        return;
      }
      try {
        isIntentionallyClosed.current = false;
        const ws = new WebSocket(url);

        ws.onopen = () => {
          console.log('[WebSocket] Connected:', url);
          reconnectCountRef.current = 0;
          setIsConnected(true);
          onOpen?.();
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            onMessage(data);
          } catch (err) {
            console.error('[WebSocket] Failed to parse message:', err);
          }
        };

        ws.onerror = (error) => {
          console.error('[WebSocket] Error:', error);
          onError?.(error);
        };

        ws.onclose = () => {
          console.log('[WebSocket] Closed:', url);
          setIsConnected(false);
          onClose?.();

          // Auto-reconnect logic
          if (reconnectEnabled && !isIntentionallyClosed.current && reconnectCountRef.current < maxAttempts) {
            reconnectCountRef.current += 1;
            const delay = Math.min(1000 * Math.pow(2, reconnectCountRef.current - 1), 30000); // Exponential backoff
            console.log(`[WebSocket] Reconnecting in ${delay}ms (attempt ${reconnectCountRef.current})...`);

            reconnectTimeoutRef.current = setTimeout(() => {
              connectSocket();
            }, delay);
          }
        };

        wsRef.current = ws;
      } catch (error) {
        console.error('[WebSocket] Connection failed:', error);
      }
    },
    [url, options, reconnectEnabled, maxAttempts],
  );

  const disconnect = useCallback(() => {
    isIntentionallyClosed.current = true;
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (wsRef.current) {
      if (wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.close();
      }
      wsRef.current = null;
    }
    setIsConnected(false);
  }, []);

  const send = useCallback((data: any) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    } else {
      console.warn('[WebSocket] Not connected, cannot send message');
    }
  }, []);

  useEffect(() => {
    connect();

    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  return {
    isConnected,
    send,
    disconnect,
  };
};
