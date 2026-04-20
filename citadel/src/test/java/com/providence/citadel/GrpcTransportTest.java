package com.providence.citadel;

import io.grpc.ManagedChannel;
import io.grpc.ManagedChannelBuilder;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;
import providence.Event.ClassifiedEvent;
import providence.Event.Classification;
import providence.Event.EventAck;
import providence.EventServiceGrpc;

import java.util.UUID;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Testcontainers
class GrpcTransportTest {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>(DockerImageName.parse("postgres:16-alpine"))
        .withDatabaseName("providence")
        .withUsername("providence")
        .withPassword("providence");

    @Container
    static GenericContainer<?> redis = new GenericContainer<>(DockerImageName.parse("redis:7-alpine"))
        .withExposedPorts(6379);

    @DynamicPropertySource
    static void configureProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
        registry.add("spring.data.redis.host", redis::getHost);
        registry.add("spring.data.redis.port", () -> redis.getMappedPort(6379));
    }

    private ManagedChannel channel;

    @BeforeEach
    void setupChannel() {
        // grpc-server-spring-boot-starter defaults to port 50051,
        // but in test it may use a random port. We use the configured default.
        channel = ManagedChannelBuilder.forAddress("localhost", 50051)
            .usePlaintext()
            .build();
    }

    @AfterEach
    void teardownChannel() throws Exception {
        if (channel != null) {
            channel.shutdownNow().awaitTermination(5, TimeUnit.SECONDS);
        }
    }

    @Test
    void reportEventViaGrpcTransport() {
        EventServiceGrpc.EventServiceBlockingStub stub = EventServiceGrpc.newBlockingStub(channel);

        String eventId = UUID.randomUUID().toString();

        ClassifiedEvent request = ClassifiedEvent.newBuilder()
            .setEventId(eventId)
            .setTimestamp(System.currentTimeMillis())
            .setSourceIp("10.0.0.50")
            .setSourcePort(54321)
            .setDestIp("192.168.1.100")
            .setDestPort(443)
            .setProtocol("TCP")
            .setClassification(Classification.newBuilder()
                .setCategory("DOS")
                .setSubcategory("syn_flood")
                .setConfidence(0.92f)
                .build())
            .setSourceComponent("eye")
            .setJa3Hash("abc123def456abc123def456abc12345")
            .setFlowDuration(12.5f)
            .setPacketCount(1500)
            .setByteCount(750000)
            .build();

        EventAck ack = stub.reportEvent(request);

        assertThat(ack.getEventId()).isEqualTo(eventId);
        assertThat(ack.getAccepted()).isTrue();
        assertThat(ack.getResponseAction()).isEqualTo("ACT");
    }

    @Test
    void reportEventObserveTierViaGrpc() {
        EventServiceGrpc.EventServiceBlockingStub stub = EventServiceGrpc.newBlockingStub(channel);

        ClassifiedEvent request = ClassifiedEvent.newBuilder()
            .setEventId(UUID.randomUUID().toString())
            .setTimestamp(System.currentTimeMillis())
            .setSourceIp("10.0.0.51")
            .setSourcePort(11111)
            .setDestIp("192.168.1.101")
            .setDestPort(80)
            .setProtocol("TCP")
            .setClassification(Classification.newBuilder()
                .setCategory("BENIGN")
                .setConfidence(0.3f)
                .build())
            .setSourceComponent("eye")
            .build();

        EventAck ack = stub.reportEvent(request);

        assertThat(ack.getAccepted()).isTrue();
        assertThat(ack.getResponseAction()).isEqualTo("OBSERVE");
    }

    @Test
    void reportEventRecommendTierViaGrpc() {
        EventServiceGrpc.EventServiceBlockingStub stub = EventServiceGrpc.newBlockingStub(channel);

        ClassifiedEvent request = ClassifiedEvent.newBuilder()
            .setEventId(UUID.randomUUID().toString())
            .setTimestamp(System.currentTimeMillis())
            .setSourceIp("10.0.0.52")
            .setSourcePort(22222)
            .setDestIp("192.168.1.102")
            .setDestPort(22)
            .setProtocol("TCP")
            .setClassification(Classification.newBuilder()
                .setCategory("BRUTE_FORCE")
                .setConfidence(0.72f)
                .build())
            .setSourceComponent("eye")
            .build();

        EventAck ack = stub.reportEvent(request);

        assertThat(ack.getAccepted()).isTrue();
        assertThat(ack.getResponseAction()).isEqualTo("RECOMMEND");
    }
}
