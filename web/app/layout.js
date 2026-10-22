import './globals.css';
import Header from '../components/Header';
import Walkthrough from '../components/Walkthrough';
export const metadata = { title: 'Verity — Brand Governance', description: 'Every word. Every pixel. On brand.' };
export const viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 0 }}>
        <a href="#main" className="skip">Skip to content</a>
        <Header />
        <div id="main">{children}</div>
        <Walkthrough />
      </body>
    </html>
  );
}
