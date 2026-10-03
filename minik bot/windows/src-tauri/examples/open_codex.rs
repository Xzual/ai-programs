#[path = "../src/codex_open.rs"]
mod codex_open;
fn main() {
    codex_open::open(None).expect("Codex launch failed");
    println!("Windows accepted the Codex app launch. No VS Code or new chat requested.");
}
