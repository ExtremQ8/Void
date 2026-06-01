import { QRCodeSVG } from 'qrcode.react';

export default function QRCode({ value }) {
  if (!value) {
    return null;
  }

  return (
    <div className="mx-auto flex h-48 w-48 items-center justify-center rounded-[20px] bg-white p-3">
      <QRCodeSVG value={value} size={168} bgColor="#ffffff" fgColor="#000000" />
    </div>
  );
}
