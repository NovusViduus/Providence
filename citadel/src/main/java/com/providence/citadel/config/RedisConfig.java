package com.providence.citadel.config;

import com.providence.citadel.websocket.EventWebSocketHandler;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.listener.ChannelTopic;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;
import org.springframework.data.redis.listener.adapter.MessageListenerAdapter;

@Configuration
public class RedisConfig {

    @Bean
    public ChannelTopic eventsTopic() {
        return new ChannelTopic("providence:events");
    }

    @Bean
    public MessageListenerAdapter messageListener(EventWebSocketHandler handler) {
        return new MessageListenerAdapter(handler, "onRedisMessage");
    }

    @Bean
    public RedisMessageListenerContainer redisContainer(
            RedisConnectionFactory connectionFactory,
            MessageListenerAdapter messageListener,
            ChannelTopic eventsTopic) {
        RedisMessageListenerContainer container = new RedisMessageListenerContainer();
        container.setConnectionFactory(connectionFactory);
        container.addMessageListener(messageListener, eventsTopic);
        return container;
    }
}
