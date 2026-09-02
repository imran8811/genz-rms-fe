"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";

type SettingsMap = Record<string, string>;

const fallback: SettingsMap = {
  restaurant_name:          "Gen Z Foods",
  tagline:                  "Fresh & Fast",
  address:                  "Garden Town, Sher Shah Road, Multan",
  phone:                    "03 000-911-000",
  whatsapp:                 "03 000-911-000",
  timing:                   "02:00 PM - 2:00 AM",
  currency:                 "PKR",
  tax_rate:                 "0",
  default_delivery_charge:  "100",
  receipt_footer:           "Thank you! Visit Again",
  table_count:              "20",
};

export default function SettingsPage() {
  const [settings, setSettings]           = useState<SettingsMap>(fallback);
  const [loading, setLoading]             = useState(true);
  const [saving, setSaving]               = useState(false);
  const [saved, setSaved]                 = useState(false);
  const [error, setError]                 = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState("restaurant");


  useEffect(() => {
    api.get<SettingsMap>("/settings")
      .then((data) => setSettings({ ...fallback, ...data }))
      .catch(() => { /* keep fallback values */ })
      .finally(() => setLoading(false));
  }, []);

  const set = (key: string, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.put("/settings", settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const sections = [
    { id: "restaurant", label: "Restaurant Info" },
    { id: "billing",    label: "Billing & Tax" },
    { id: "receipt",    label: "Receipt" },
    { id: "operations", label: "Operations" },
  ];

  const field = (label: string, key: string, type = "text") => (
    <div key={key}>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">{label}</label>
      {loading
        ? <div className="h-9 bg-gray-100 rounded-lg animate-pulse"/>
        : <input
            type={type}
            value={settings[key] ?? ""}
            onChange={(e) => set(key, e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red"
          />
      }
    </div>
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Settings</h1>
          <p className="text-sm text-gray-500">Restaurant configuration and preferences</p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-50 ${
            saved ? "bg-green-600 text-white" : "bg-brand-red text-white hover:bg-brand-red-dark"
          }`}
        >
          {saved ? (
            <>
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
              </svg>
              Saved!
            </>
          ) : saving ? "Saving…" : (
            <>
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path d="M7.707 10.293a1 1 0 10-1.414 1.414l3 3a1 1 0 001.414 0l3-3a1 1 0 00-1.414-1.414L11 11.586V6h5a2 2 0 012 2v7a2 2 0 01-2 2H4a2 2 0 01-2-2V8a2 2 0 012-2h5v5.586l-1.293-1.293z"/>
              </svg>
              Save Changes
            </>
          )}
        </button>
      </div>

      {error && (
        <div className="mx-6 mt-4 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          Could not save: {error}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        <div className="w-48 flex-shrink-0 bg-white border-r border-gray-200 py-4 px-3">
          <ul className="space-y-0.5">
            {sections.map((s) => (
              <li key={s.id}>
                <button
                  onClick={() => setActiveSection(s.id)}
                  className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-all ${
                    activeSection === s.id ? "bg-brand-red text-white font-medium" : "text-gray-600 hover:bg-gray-100"
                  }`}
                >
                  {s.label}
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex-1 overflow-y-auto p-6">

          {activeSection === "restaurant" && (
            <div className="max-w-lg">
              <h2 className="text-base font-semibold text-gray-900 mb-4">Restaurant Information</h2>
              <div className="bg-white rounded-xl border border-gray-100 shadow-soft p-6 space-y-5">
                {field("Restaurant Name", "restaurant_name")}
                {field("Tagline",         "tagline")}
                {field("Address",         "address")}
                {field("Phone Number",    "phone")}
                {field("WhatsApp",        "whatsapp")}
                {field("Business Hours",  "timing")}
              </div>
            </div>
          )}

          {activeSection === "billing" && (
            <div className="max-w-lg">
              <h2 className="text-base font-semibold text-gray-900 mb-4">Billing & Tax</h2>
              <div className="bg-white rounded-xl border border-gray-100 shadow-soft p-6 space-y-5">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Currency</label>
                  {loading
                    ? <div className="h-9 bg-gray-100 rounded-lg animate-pulse"/>
                    : <select
                        value={settings.currency ?? "PKR"}
                        onChange={(e) => set("currency", e.target.value)}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-red"
                      >
                        <option value="PKR">PKR — Pakistani Rupee</option>
                        <option value="USD">USD — US Dollar</option>
                        <option value="AED">AED — UAE Dirham</option>
                      </select>
                  }
                </div>
                {field("Tax Rate (%)",                   "tax_rate",                "number")}
                {field("Default Delivery Charge (PKR)",  "default_delivery_charge", "number")}
              </div>
            </div>
          )}

          {activeSection === "receipt" && (
            <div className="max-w-lg">
              <h2 className="text-base font-semibold text-gray-900 mb-4">Receipt Settings</h2>
              <div className="bg-white rounded-xl border border-gray-100 shadow-soft p-6 space-y-5">
                {field("Receipt Footer Message", "receipt_footer")}

                {!loading && (
                  <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                    <div className="text-xs font-medium text-gray-500 mb-2">Receipt Preview</div>
                    <div className="font-mono text-xs text-gray-700 space-y-1">
                      <div className="text-center font-bold">{settings.restaurant_name}</div>
                      <div className="text-center text-gray-400">{settings.address}</div>
                      <div className="text-center text-gray-400">{settings.phone}</div>
                      <div className="border-t border-dashed border-gray-300 my-1"/>
                      <div>Bill #: 00045</div>
                      <div>Type: Dine-in</div>
                      <div className="border-t border-dashed border-gray-300 my-1"/>
                      <div className="flex justify-between"><span>Zinger Burger x1</span><span>750</span></div>
                      <div className="flex justify-between"><span>Pizza (M) x1</span><span>1500</span></div>
                      <div className="border-t border-dashed border-gray-300 my-1"/>
                      <div className="flex justify-between font-bold"><span>TOTAL</span><span>Rs2250</span></div>
                      <div className="border-t border-dashed border-gray-300 my-1"/>
                      <div className="text-center">{settings.receipt_footer}</div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeSection === "operations" && (
            <div className="max-w-lg">
              <h2 className="text-base font-semibold text-gray-900 mb-4">Operations</h2>
              <div className="bg-white rounded-xl border border-gray-100 shadow-soft p-6 space-y-5">
                {field("Number of Tables", "table_count", "number")}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Order Types Available</label>
                  {["Dine-in", "Takeaway", "Delivery"].map((type) => (
                    <label key={type} className="flex items-center gap-3 mb-2 cursor-pointer">
                      <input type="checkbox" defaultChecked className="w-4 h-4 accent-brand-red"/>
                      <span className="text-sm text-gray-700">{type}</span>
                    </label>
                  ))}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Features</label>
                  {["Family Hall", "Roof Top Sitting", "Quick Delivery", "Take Away", "Dine In"].map((feat) => (
                    <label key={feat} className="flex items-center gap-3 mb-2 cursor-pointer">
                      <input type="checkbox" defaultChecked className="w-4 h-4 accent-brand-red"/>
                      <span className="text-sm text-gray-700">{feat}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
