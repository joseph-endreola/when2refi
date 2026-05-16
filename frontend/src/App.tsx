import { Show, SignInButton, SignUpButton, UserButton } from "@clerk/react";

export default function App() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-bold">when2refi.com</h1>
      <p className="text-gray-500">Decision support for homeowners and investors.</p>
      <Show when="signed-out">
        <div className="flex gap-4">
          <SignInButton />
          <SignUpButton />
        </div>
      </Show>
      <Show when="signed-in">
        <UserButton />
      </Show>
    </div>
  );
}
