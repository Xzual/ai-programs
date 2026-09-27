export type SafeDesktopApp = 'notepad' | 'calculator';

export type ComputerCommandTask =
  | { id: string; kind: 'open_panel'; label: string }
  | { id: string; kind: 'blocked'; errorCode: 'critical_action_blocked'; label: string }
  | { id: string; kind: 'observe'; label: string }
  | { id: string; kind: 'move_test'; label: string }
  | { id: string; kind: 'click_test'; label: string }
  | { id: string; kind: 'type_test'; label: string }
  | { id: string; kind: 'hotkey_test'; label: string }
  | { id: string; kind: 'scroll_test'; label: string }
  | { id: string; kind: 'open_app'; app: SafeDesktopApp; label: string }
  | { id: string; kind: 'stop'; label: string };

function task<T extends Omit<ComputerCommandTask, 'id'>>(value: T): T & { id: string } {
  return { ...value, id: `computer-task-${Date.now()}` };
}

export function parseComputerCommand(message: string): ComputerCommandTask | null {
  const text = message.toLocaleLowerCase('tr-TR').trim();
  if (!text || /(?:çalışıyor mu|hazır mı|durumu ne|hangi yetenek|neler yapabiliyor|what can|status)/i.test(text)) return null;

  const computerContext = /(?:computer use|bilgisayar|masaüstü|tarayıcı|browser|notepad|not defteri|hesap makinesi|kill switch)/i.test(text);
  const criticalAction = /(?:satın al|purchase|\bbuy\b|ödeme|payment|para transfer|havale|trade|trading|gerçek alım satım|mail gönder|e-?posta gönder|mesaj gönder|send (?:an )?(?:email|message)|kalıcı.{0,12}sil|delete|format(?:la| drive)?|şifre|parola|password|credential|api key|secret|kill switch.{0,20}(?:kapat|devre dışı|disable)|(?:powershell|cmd|terminal).{0,16}(?:çalıştır|run|aç))/i.test(text);
  if (computerContext && criticalAction) {
    return task({
      kind: 'blocked',
      errorCode: 'critical_action_blocked',
      label: 'Kritik Computer Use isteği engellendi; ödeme, dış iletişim, kalıcı silme, kimlik bilgisi ve güvenlik kapatma eylemleri bu oturumdan çalıştırılmaz.',
    });
  }

  if (/(?:computer use|bilgisayar kullanımı|masaüstü kontrol).{0,24}(?:durdur|kapat|stop|interrupt)|(?:durdur|stop).{0,24}(?:computer use|bilgisayar kullanım)/i.test(text)) {
    return task({ kind: 'stop', label: 'Computer Use oturumunu durdur.' });
  }
  if (/(?:notepad|not defteri)/i.test(text) && /(?:aç|başlat|open|launch)/i.test(text)) {
    return task({ kind: 'open_app', app: 'notepad', label: 'Not Defteri uygulamasını güvenli izin listesi üzerinden aç.' });
  }
  if (/(?:calculator|hesap makinesi)/i.test(text) && /(?:aç|başlat|open|launch)/i.test(text)) {
    return task({ kind: 'open_app', app: 'calculator', label: 'Hesap Makinesi uygulamasını güvenli izin listesi üzerinden aç.' });
  }
  if (/(?:ekrana bak|ekranı gözlem|ekran görüntüsü|screenshot|observe screen)/i.test(text)) {
    return task({ kind: 'observe', label: 'Birincil ekranı gözlemle ve gerçek ekran görüntüsünü göster.' });
  }
  if (/(?:fare|mouse).{0,24}(?:hareket|move).{0,16}(?:test|dene)|(?:test|dene).{0,16}(?:fare|mouse)/i.test(text)) {
    return task({ kind: 'move_test', label: 'Fareyi güvenli bir noktaya taşı ve başlangıç konumuna döndür.' });
  }
  if (/(?:click|tıkla|tıklama).{0,24}(?:test|dene)|(?:test|dene).{0,16}(?:click|tık)/i.test(text)) {
    return task({ kind: 'click_test', label: 'Uygulama içindeki güvenli hedefte yerel tıklama testi yap.' });
  }
  if (/edith_computer_use_ok/i.test(text) || /(?:keyboard|klavye|typing|yazma).{0,24}(?:test|dene)/i.test(text)) {
    return task({ kind: 'type_test', label: 'Uygulama içindeki güvenli alana EDITH_COMPUTER_USE_OK yaz.' });
  }
  if (/(?:hotkey|kısayol).{0,24}(?:test|dene)|(?:test|dene).{0,16}(?:hotkey|kısayol)/i.test(text)) {
    return task({ kind: 'hotkey_test', label: 'Güvenli test alanında Ctrl+A kısayolunu doğrula.' });
  }
  if (/(?:scroll|kaydır).{0,24}(?:test|dene)|(?:test|dene).{0,16}(?:scroll|kaydır)/i.test(text)) {
    return task({ kind: 'scroll_test', label: 'Uygulama içindeki güvenli alanda kaydır ve geri dön.' });
  }
  if (/(?:computer use|bilgisayar kullanımı|bilgisayarı kullan|masaüstünü kullan)/i.test(text)) {
    return task({ kind: 'open_panel', label: 'Computer Use denetim ekranını aç.' });
  }
  return null;
}

export function computerTaskAcknowledgement(value: ComputerCommandTask): string {
  if (value.kind === 'stop') return 'Computer Use durdurma isteği güvenli yerel kanala iletildi.';
  if (value.kind === 'open_panel') return 'Computer Use denetim ekranını açıyorum. Yerel kontroller varsayılan olarak kapalı kalır.';
  if (value.kind === 'blocked') return `Computer Use isteği engellendi (${value.errorCode}). ${value.label}`;
  return `Computer Use görevi hazır: ${value.label} Yerel eylem yalnızca Tauri masaüstünde, aktif olmayan kill switch ve Windows sahibi onayıyla çalışır.`;
}
