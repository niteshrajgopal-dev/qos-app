"use client";

import type { ReactNode } from "react";

import {
  PortalBadge,
  type PortalBadgeTone,
  PortalField,
  PortalNotice,
  PortalPanel,
  PortalStat,
  PortalStatGrid,
} from "@/components/portal/workspace/PortalWorkspace";
import { useStaffLocale } from "@/components/staff/StaffLocaleProvider";
import { isolateText } from "@/lib/staff/branch-copy";
import { staffCopyWith, staffUiCopy, type StaffUiCopyKey } from "@/lib/staff/locale";
import type { CapabilityClass } from "@/lib/workbook/dictionary";
import type { FoodicsMenuParseResult, FoodicsRequiredMapping } from "@/lib/workbook/foodics-menu/reader";
import { WORKBOOK_CAPABILITY_COPY, WORKBOOK_REGION_COPY } from "@/lib/workbook/import-view";

/* QOS-216: what QOS recognised in a Foodics menu workbook. Shows the source
   profile, the areas read and the sheets left alone, the mappings the
   conversion needs, and which fields are recognised or deferred. The only
   action is downloading the converted QOS workbook; nothing is imported,
   reviewed or applied here. */

const CAPABILITY_TONE: Record<CapabilityClass, PortalBadgeTone> = {
  recognized: "positive",
  validated: "positive",
  persistable: "positive",
  deferred: "warm",
};

const CAPABILITY_ORDER: CapabilityClass[] = ["recognized", "validated", "persistable", "deferred"];

type BrandChoice = { publicId: string; name: string };

function mappingOf<K extends FoodicsRequiredMapping["kind"]>(result: FoodicsMenuParseResult, kind: K) {
  return result.requiredMappings.filter((mapping): mapping is Extract<FoodicsRequiredMapping, { kind: K }> => mapping.kind === kind);
}

export function FoodicsMenuResult({
  result,
  brand,
  onBrandChange,
  converting,
  onConvert,
  issueList,
}: {
  result: FoodicsMenuParseResult;
  brand: string;
  onBrandChange: (brand: string) => void;
  converting: boolean;
  onConvert: () => void;
  issueList: ReactNode;
}) {
  const { locale } = useStaffLocale();
  const t = (key: StaffUiCopyKey) => staffUiCopy(locale, key);

  const [currency] = mappingOf(result, "currency");
  const [brandMapping] = mappingOf(result, "brand");
  const [namespace] = mappingOf(result, "namespace");
  const channels = mappingOf(result, "channel");
  const brandChoices: BrandChoice[] = brandMapping?.choices ?? [];
  const brandNeeded = brandMapping?.status === "required";
  const brandReady = !brandNeeded || Boolean(brand);
  const resolvedBrand = brandMapping?.status === "resolved" ? brandMapping.value : brandChoices.find((choice) => choice.publicId === brand)?.publicId;

  const capabilityGroups = CAPABILITY_ORDER.map((capabilityClass) => {
    const bySheet = new Map<string, { columns: string[]; owner: string }>();
    for (const entry of result.capabilities.filter((capability) => capability.class === capabilityClass)) {
      const group = bySheet.get(entry.sheet) ?? { columns: [], owner: entry.owner };
      group.columns.push(entry.column);
      bySheet.set(entry.sheet, group);
    }
    return { capabilityClass, sheets: [...bySheet] };
  }).filter((group) => group.sheets.length > 0);

  return (
    <PortalPanel>
      <h2 className="qosp-panel-title">{t("importFoodicsTitle")}</h2>
      <p className="qosp-meta-line">
        {staffCopyWith(locale, "importFoodicsRecognised", {
          version: result.profileVersion,
          dictionary: result.dictionaryVersion,
        })}
      </p>
      <p className="qosp-meta-line">
        {staffCopyWith(locale, "importResultFile", { name: isolateText(result.fileName) })}
        {" · "}
        {t("importFoodicsFingerprint")}{" "}
        <code className="qosp-code" dir="ltr">
          {result.fileFingerprint.slice(0, 8)}
        </code>
      </p>
      <div className="qosp-panel-body qosp-stack">
        <PortalNotice tone="info">{t("importFoodicsNotApplied")}</PortalNotice>
        <PortalNotice tone="info">{t("importFoodicsVariantNote")}</PortalNotice>
      </div>

      <div className="qosp-panel-body">
        <PortalStatGrid columns={2}>
          <PortalStat label={t("importStatReady")} value={String(result.summary.recognizedRows)} sub={t("importStatReadySub")} />
          <PortalStat
            label={t("importStatDeferred")}
            value={String(result.summary.deferredRows + result.summary.deferredValues)}
            sub={t("importStatDeferredFoodicsSub")}
          />
          <PortalStat label={t("importStatRejected")} value={String(result.summary.rejected.rows)} sub={t("importStatRejectedSub")} />
          <PortalStat
            label={t("importStatAttention")}
            value={String(result.summary.errors + result.summary.warnings)}
            sub={t("importStatAttentionSub")}
          />
        </PortalStatGrid>
      </div>

      <h3 className="qosp-subcard-title qosp-panel-body">{t("importScopeTitle")}</h3>
      <ul className="qosp-branch-list qosp-panel-body" aria-label={t("importScopeTitle")}>
        {result.layout.regions.map((region) => (
          <li key={region.id} className="qosp-branch-row qosp-subcard">
            <div className="qosp-branch-row-main">
              <span className="qosp-branch-row-label">{t("importColumnArea")}</span>
              <span className="qosp-branch-row-name">{t(WORKBOOK_REGION_COPY[region.id])}</span>
            </div>
            <div className="qosp-branch-row-main">
              <span className="qosp-branch-row-label">{t("importColumnSheet")}</span>
              <bdi dir="ltr">{region.sheet}</bdi>
            </div>
            <div className="qosp-branch-row-main">
              <span className="qosp-branch-row-label">{t("importColumnHeaderRange")}</span>
              <code className="qosp-code" dir="ltr">
                {region.headerRef}
              </code>
            </div>
            <div className="qosp-branch-row-main">
              <span className="qosp-branch-row-label">{t("importColumnRecords")}</span>
              <span>{region.businessRows}</span>
            </div>
            <div className="qosp-branch-row-main">
              <span className="qosp-branch-row-label">{t("importColumnExamplesSkipped")}</span>
              <span>{region.exampleRowsSkipped}</span>
            </div>
            <div className="qosp-branch-row-main">
              <span className="qosp-branch-row-label">{t("importColumnUnmapped")}</span>
              <span>{region.unmappedHeaders.length}</span>
            </div>
          </li>
        ))}
      </ul>

      {result.layout.ignoredSheets.length > 0 ? (
        <>
          <h3 className="qosp-subcard-title qosp-panel-body">{t("importIgnoredTitle")}</h3>
          <ul className="qosp-branch-list qosp-panel-body" aria-label={t("importIgnoredTitle")}>
            {result.layout.ignoredSheets.map((ignored) => (
              <li key={ignored.sheet} className="qosp-branch-row qosp-subcard">
                <div className="qosp-branch-row-main">
                  <span className="qosp-branch-row-label">{t("importColumnSheet")}</span>
                  <bdi className="qosp-branch-row-name" dir="ltr">
                    {ignored.sheet}
                  </bdi>
                </div>
                <div className="qosp-branch-row-status">
                  <PortalBadge
                    tone={ignored.reason === "credentials" ? "warm" : "neutral"}
                    wrap={ignored.reason === "credentials"}
                  >
                    {t(ignored.reason === "credentials" ? "importIgnoredCredentials" : "importIgnoredGuidance")}
                  </PortalBadge>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <h3 className="qosp-subcard-title qosp-panel-body">{t("importMappingsTitle")}</h3>
      <ul className="qosp-branch-list qosp-panel-body" aria-label={t("importMappingsTitle")}>
        <li className="qosp-branch-row qosp-subcard">
          <div className="qosp-branch-row-main">
            <span className="qosp-branch-row-label">{t("importMappingCurrency")}</span>
            {currency?.value ? (
              <code className="qosp-code" dir="ltr">
                {currency.value}
              </code>
            ) : null}
          </div>
          <div className="qosp-branch-row-status">
            <PortalBadge tone={currency?.status === "resolved" ? "positive" : "danger"}>
              {t(currency?.status === "resolved" ? "importMappingResolved" : "importMappingRequired")}
            </PortalBadge>
          </div>
        </li>
        <li className="qosp-branch-row qosp-subcard">
          <div className="qosp-branch-row-main">
            <span className="qosp-branch-row-label">{t("importMappingBrand")}</span>
            {resolvedBrand ? (
              <code className="qosp-code" dir="ltr">
                {resolvedBrand}
              </code>
            ) : null}
          </div>
          <div className="qosp-branch-row-status">
            <PortalBadge tone={brandReady ? "positive" : "danger"}>
              {t(brandReady ? "importMappingResolved" : "importMappingRequired")}
            </PortalBadge>
          </div>
        </li>
        <li className="qosp-branch-row qosp-subcard">
          <div className="qosp-branch-row-main">
            <span className="qosp-branch-row-label">{t("importMappingNamespace")}</span>
            {namespace?.value ? (
              <code className="qosp-code" dir="ltr">
                {namespace.value}
              </code>
            ) : null}
          </div>
          <div className="qosp-branch-row-status">
            <PortalBadge tone={namespace?.status === "resolved" ? "positive" : "danger"}>
              {t(namespace?.status === "resolved" ? "importMappingResolved" : "importMappingRequired")}
            </PortalBadge>
          </div>
        </li>
        {channels.map((channel) => (
          <li key={channel.label} className="qosp-branch-row qosp-subcard">
            <div className="qosp-branch-row-main">
              <span className="qosp-branch-row-label">{t("importMappingChannel")}</span>
              <bdi className="qosp-branch-row-name" dir="ltr">
                {channel.label}
              </bdi>
            </div>
            <div className="qosp-branch-row-main">
              <span>{staffCopyWith(locale, "importMappingChannelPrices", { count: channel.prices })}</span>
            </div>
            <div className="qosp-branch-row-status">
              <PortalBadge tone="warm">{t("importMappingChannelDeferred")}</PortalBadge>
            </div>
          </li>
        ))}
      </ul>
      {channels.length > 0 ? <p className="qosp-panel-help qosp-panel-body">{t("importMappingChannelHelp")}</p> : null}

      {capabilityGroups.length > 0 ? (
        <>
          <h3 className="qosp-subcard-title qosp-panel-body">{t("importCapabilitiesTitle")}</h3>
          <ul className="qosp-branch-list qosp-panel-body" aria-label={t("importCapabilitiesTitle")}>
            {capabilityGroups.flatMap((group) =>
              group.sheets.map(([sheet, entry]) => (
                <li key={`${group.capabilityClass}-${sheet}`} className="qosp-subcard">
                  <div className="qosp-meta-row">
                    <PortalBadge tone={CAPABILITY_TONE[group.capabilityClass]}>
                      {t(WORKBOOK_CAPABILITY_COPY[group.capabilityClass])}
                    </PortalBadge>
                    <bdi dir="ltr">{sheet}</bdi>
                  </div>
                  <p className="qosp-panel-help">
                    <code className="qosp-code" dir="ltr">
                      {entry.columns.join(", ")}
                    </code>
                  </p>
                  {entry.owner ? (
                    <p className="qosp-meta-line">{staffCopyWith(locale, "importCapabilityOwner", { owner: isolateText(entry.owner) })}</p>
                  ) : null}
                </li>
              )),
            )}
          </ul>
        </>
      ) : null}

      {issueList}

      {brandNeeded ? (
        <div className="qosp-panel-body">
          <PortalField label={t("importFoodicsBrandLabel")} help={t("importFoodicsBrandRequired")}>
            <select className="qos-input" value={brand} onChange={(event) => onBrandChange(event.target.value)}>
              <option value="">{t("importFoodicsBrandLabel")}</option>
              {brandChoices.map((choice) => (
                <option key={choice.publicId} value={choice.publicId}>
                  {choice.name}
                </option>
              ))}
            </select>
          </PortalField>
        </div>
      ) : null}
      <div className="qosp-button-row qosp-panel-body">
        <button
          className="qos-btn"
          data-variant="primary"
          type="button"
          disabled={converting || !brandReady}
          onClick={onConvert}
        >
          {converting ? t("importDownloading") : t("importConvertDownload")}
        </button>
      </div>
    </PortalPanel>
  );
}
