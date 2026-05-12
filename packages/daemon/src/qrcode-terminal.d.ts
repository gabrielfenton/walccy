declare module 'qrcode-terminal' {
  interface Qrcode {
    generate(
      text: string,
      opts: { small: boolean },
      cb: (qr: string) => void
    ): void;
  }
  const qr: Qrcode;
  export default qr;
}
