import Image from "next/image";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 p-8">
      <Image
        src="/logo.png"
        alt=""
        width={128}
        height={128}
        priority
        className="rounded-xl shadow-sm"
      />
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">ChatLog</h1>
        <p className="text-sm text-muted-foreground">
          Scaffold ready — features ship next.
        </p>
      </div>
    </main>
  );
}
