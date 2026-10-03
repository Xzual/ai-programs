// Explicit owner-approved one-time setup. Never overwrite an existing key.
#[allow(dead_code)]
#[path = "../src/secrets.rs"]
mod secrets;
fn main() {
    if secrets::present("gemini-api-key") {
        println!("Existing Gemini credential preserved in Windows Credential Manager.");
        return;
    }
    let key = std::env::var("GEMINI_API_KEY").expect("No configured Gemini key supplied");
    if key.trim().is_empty() { panic!("Configured Gemini key is empty"); }
    secrets::set("gemini-api-key", &key).expect("Cannot store Gemini credential");
    assert!(secrets::present("gemini-api-key"));
    println!("Gemini credential stored in Windows Credential Manager. Key not printed.");
}
