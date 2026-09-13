/* Progressive skeleton for the stock page: header → quote → chart → outlook.
   Mirrors the real layout so the transition is calm, not a spinner flash. */
export default function StockLoading() {
  return (
    <div className="space-y-5">
      <div className="skel h-3 w-40" />
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3.5">
          <div className="skel h-11 w-11" />
          <div className="space-y-2">
            <div className="skel h-5 w-56" />
            <div className="skel h-8 w-40" />
            <div className="skel h-3 w-48" />
          </div>
        </div>
        <div className="hidden gap-2 sm:flex">
          <div className="skel h-[34px] w-24" />
          <div className="skel h-[34px] w-20" />
          <div className="skel h-[34px] w-24" />
        </div>
      </div>
      <div className="panel p-4">
        <div className="skel mb-3 h-7 w-64" />
        <div className="skel h-[300px] w-full" />
      </div>
      <div className="panel p-4">
        <div className="skel mb-4 h-4 w-52" />
        <div className="skel h-24 w-full" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => <div key={i} className="skel h-14 w-full" />)}
      </div>
    </div>
  );
}
