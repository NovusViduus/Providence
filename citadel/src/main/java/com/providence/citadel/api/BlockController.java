package com.providence.citadel.api;

import com.providence.citadel.service.BlockExpiryService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/v1/blocks")
public class BlockController {

    private final BlockExpiryService blockExpiryService;

    public BlockController(BlockExpiryService blockExpiryService) {
        this.blockExpiryService = blockExpiryService;
    }

    @GetMapping
    public Map<String, String> getActiveBlocks() {
        return blockExpiryService.getActiveBlocks();
    }

    @DeleteMapping("/{ip}")
    public ResponseEntity<Map<String, String>> unblock(@PathVariable String ip) {
        blockExpiryService.manualUnblock(ip);
        return ResponseEntity.ok(Map.of("status", "unblocked", "ip", ip));
    }
}
