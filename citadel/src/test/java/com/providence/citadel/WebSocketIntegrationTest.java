package com.providence.citadel;

import com.providence.citadel.model.SecurityEvent;
import com.providence.citadel.service.EventService;
import com.providence.citadel.service.RedisEventPublisher;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketHttpHeaders;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.net.URI;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Testcontainers
@Import(TestContainersConfig.class)
class WebSocketIntegrationTest {

    @LocalServerPort
    private int port;

    @Autowired
    private RedisEventPublisher redisPublisher;

    @Autowired
    private EventService eventService;

    @Test
    void webSocketReceivesPublishedEvent() throws Exception {
        // Connect a WebSocket client
        BlockingQueue<String> messages = new LinkedBlockingQueue<>();

        StandardWebSocketClient client = new StandardWebSocketClient();
        URI uri = URI.create("ws://localhost:" + port + "/ws/events");

        WebSocketSession session = client.execute(new TextWebSocketHandler() {
            @Override
            protected void handleTextMessage(WebSocketSession session, TextMessage message) {
                messages.add(message.getPayload());
            }
        }, new WebSocketHttpHeaders(), uri).get(5, TimeUnit.SECONDS);

        assertThat(session.isOpen()).isTrue();

        // Give the subscription a moment to register
        Thread.sleep(200);

        // Create and publish an event through Redis
        SecurityEvent event = new SecurityEvent();
        event.setEventId(UUID.randomUUID().toString());
        event.setTimestamp(Instant.now());
        event.setSourceIp("10.0.0.99");
        event.setSourcePort(9999);
        event.setDestIp("192.168.1.99");
        event.setDestPort(443);
        event.setProtocol("TCP");
        event.setCategory("PROBE");
        event.setConfidence(0.55f);
        event.setSourceComponent("eye");
        event.setResponseTier("OBSERVE");

        SecurityEvent saved = eventService.save(event);
        redisPublisher.publishEvent(saved);

        // Wait for the message to arrive via Redis pub/sub → WebSocket
        String received = messages.poll(5, TimeUnit.SECONDS);

        assertThat(received).isNotNull();
        assertThat(received).contains("10.0.0.99");
        assertThat(received).contains("PROBE");
        assertThat(received).contains("OBSERVE");

        session.close();
    }

    @Test
    void webSocketHandlesNoClientsGracefully() {
        // Publishing with no connected clients should not throw
        SecurityEvent event = new SecurityEvent();
        event.setEventId(UUID.randomUUID().toString());
        event.setTimestamp(Instant.now());
        event.setSourceIp("10.0.0.100");
        event.setSourcePort(8080);
        event.setDestIp("192.168.1.100");
        event.setDestPort(80);
        event.setProtocol("TCP");
        event.setCategory("BENIGN");
        event.setConfidence(0.1f);
        event.setSourceComponent("eye");
        event.setResponseTier("OBSERVE");

        SecurityEvent saved = eventService.save(event);
        redisPublisher.publishEvent(saved);
        // No assertion needed — test passes if no exception is thrown
    }
}
