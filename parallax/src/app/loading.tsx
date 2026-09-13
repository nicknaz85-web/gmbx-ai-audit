export default function Loading() {
  return (
    <div className="space-y-5">
      <div className="skel h-[68px] w-full rounded-lg" />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <div className="space-y-5 lg:col-span-8">
          <div className="skel h-[240px] w-full rounded-lg" />
          <div className="grid grid-cols-2 gap-5">
            <div className="skel h-64 w-full rounded-lg" />
            <div className="skel h-64 w-full rounded-lg" />
          </div>
        </div>
        <div className="space-y-5 lg:col-span-4">
          <div className="skel h-40 w-full rounded-lg" />
          <div className="skel h-56 w-full rounded-lg" />
        </div>
      </div>
    </div>
  );
}
