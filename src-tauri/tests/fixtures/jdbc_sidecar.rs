use std::io::{self, BufRead, Write};

fn encode_base64(value: &str) -> String {
    let alphabet = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut encoded = String::new();
    for chunk in value.as_bytes().chunks(3) {
        let first = chunk[0];
        let second = chunk.get(1).copied().unwrap_or(0);
        let third = chunk.get(2).copied().unwrap_or(0);
        encoded.push(alphabet[(first >> 2) as usize] as char);
        encoded.push(alphabet[(((first & 3) << 4) | (second >> 4)) as usize] as char);
        encoded.push(if chunk.len() > 1 {
            alphabet[(((second & 15) << 2) | (third >> 6)) as usize] as char
        } else {
            '='
        });
        encoded.push(if chunk.len() > 2 {
            alphabet[(third & 63) as usize] as char
        } else {
            '='
        });
    }
    encoded
}

fn respond(status: &str, request_id: u64, payload: &str) {
    println!("{status}\t{request_id}\t{}", encode_base64(payload));
    io::stdout().flush().unwrap();
}

fn main() {
    let mode = std::env::args().nth(1).unwrap();
    let mut lines = io::stdin().lock().lines();
    let init = lines.next().unwrap().unwrap();
    assert!(init.starts_with("INIT\t0\t"));
    respond("OK", 0, "{}");
    if mode == "write-stall" {
        std::thread::park();
        return;
    }
    while let Some(line) = lines.next() {
        let line = line.unwrap();
        let mut parts = line.split('\t');
        let command = parts.next().unwrap();
        let request_id = parts.next().unwrap().parse::<u64>().unwrap();
        if command == "CLOSE" {
            return;
        }
        match mode.as_str() {
            "late" => {
                let _ = lines.next();
                respond("OK", request_id, "old response");
            }
            "mismatch" => respond("OK", request_id + 1, "wrong response"),
            "malformed" => {
                println!("invalid protocol frame");
                io::stdout().flush().unwrap();
            }
            "eof" => return,
            "limit" => respond(
                "LIMIT",
                request_id,
                "dummy SQL and credential must not be echoed",
            ),
            "stream-stall" if command == "QUERY_STREAM" => {
                respond("CHUNK", request_id, "{\"columns\":[],\"rows\":[[1]]}");
                std::thread::park();
            }
            "stream-limit" if command == "QUERY_STREAM" => {
                respond(
                    "CHUNK",
                    request_id,
                    &format!(
                        "{{\"columns\":[],\"rows\":[[\"{}\"]]}}",
                        "x".repeat(1024 * 1024)
                    ),
                );
                respond(
                    "OK",
                    request_id,
                    "{\"rowCount\":1,\"affectedRows\":0,\"elapsedMs\":1}",
                );
            }
            "stream-many" if command == "QUERY_STREAM" => {
                for row in 0..100 {
                    respond("CHUNK", request_id, &format!("{{\"columns\":[],\"rows\":[[{row}]]}}"));
                }
                respond("OK", request_id, "{\"rowCount\":100,\"affectedRows\":0,\"elapsedMs\":1}");
            }
            _ => respond(
                "OK",
                request_id,
                &format!(
                    "{{\"requestId\":{request_id},\"pid\":{}}}",
                    std::process::id()
                ),
            ),
        }
    }
}
