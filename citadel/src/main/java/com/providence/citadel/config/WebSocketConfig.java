package com.providence.citadel.config;

import com.providence.citadel.websocket.EventWebSocketHandler;
import io.jsonwebtoken.Jwts;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;
import org.springframework.web.socket.server.HandshakeInterceptor;

import java.net.URI;
import java.util.Map;

@Configuration
@EnableWebSocket
public class WebSocketConfig implements WebSocketConfigurer {

    private static final Logger log = LoggerFactory.getLogger(WebSocketConfig.class);

    private final EventWebSocketHandler eventWebSocketHandler;

    public WebSocketConfig(EventWebSocketHandler eventWebSocketHandler) {
        this.eventWebSocketHandler = eventWebSocketHandler;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(eventWebSocketHandler, "/ws/events")
            .addInterceptors(new JwtHandshakeInterceptor())
            .setAllowedOrigins("*");
    }

    /**
     * Validates JWT token from ?token= query parameter during WebSocket handshake.
     * Rejects unauthenticated connections.
     */
    private static class JwtHandshakeInterceptor implements HandshakeInterceptor {

        @Override
        public boolean beforeHandshake(ServerHttpRequest request, ServerHttpResponse response,
                                       WebSocketHandler wsHandler, Map<String, Object> attributes) {
            URI uri = request.getURI();
            String query = uri.getQuery();
            if (query == null || !query.contains("token=")) {
                log.warn("WebSocket handshake rejected: no token");
                return false;
            }

            String token = null;
            for (String param : query.split("&")) {
                if (param.startsWith("token=")) {
                    token = param.substring(6);
                    break;
                }
            }

            if (token == null || token.isEmpty()) {
                log.warn("WebSocket handshake rejected: empty token");
                return false;
            }

            try {
                var claims = Jwts.parser()
                    .verifyWith(JwtAuthFilter.KEY)
                    .build()
                    .parseSignedClaims(token)
                    .getPayload();
                attributes.put("username", claims.getSubject());
                attributes.put("role", claims.get("role", String.class));
                return true;
            } catch (Exception e) {
                log.warn("WebSocket handshake rejected: invalid token — {}", e.getMessage());
                return false;
            }
        }

        @Override
        public void afterHandshake(ServerHttpRequest request, ServerHttpResponse response,
                                   WebSocketHandler wsHandler, Exception exception) {
            // no-op
        }
    }
}
