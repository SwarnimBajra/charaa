import csv


class BirdTraitDB:
    def __init__(self, file_path):
        self.species = {}

        with open(file_path, newline="", encoding="utf-8", errors="replace") as f:
            reader = csv.DictReader(f, delimiter="\t")

            for row in reader:
                name = row["Scientific"].strip().lower()
                self.species[name] = row

    def _to_float(self, value):
        try:
            return float(value)
        except:
            return 0.0

    def forest_dependency_score(self, scientific_name):
        """
        Returns forest dependency score between 0 and 1.

        Combines TWO signals from EltonTraits:
          1. Foraging stratum — what proportion of time is spent in
             forest-associated strata (understory, midhigh, canopy)
             vs. open strata (ground, aerial, water)
          2. Diet composition — frugivores, nectarivores, and insectivores
             are more likely to be forest-dependent than granivores or
             scavengers

        This is a PROXY. For true forest dependency you need BirdLife
        International's classification (High / Medium / Low / Non-forest).
        """

        key = scientific_name.strip().lower()

        if key not in self.species:
            return None

        row = self.species[key]

        # ----- Foraging Stratum Component -----
        ground = self._to_float(row["ForStrat-ground"])
        understory = self._to_float(row["ForStrat-understory"])
        midhigh = self._to_float(row["ForStrat-midhigh"])
        canopy = self._to_float(row["ForStrat-canopy"])
        aerial = self._to_float(row["ForStrat-aerial"])
        water_below = self._to_float(row.get("ForStrat-watbelowsurf", 0))
        water_around = self._to_float(row.get("ForStrat-wataroundsurf", 0))

        total_strat = ground + understory + midhigh + canopy + aerial + water_below + water_around

        if total_strat == 0:
            strat_score = 0.0
        else:
            # Forest-interior strata (understory + midhigh + canopy)
            # are strong forest indicators.
            # Ground foraging is weakly forest-associated (many ground
            # foragers are open-habitat). Gets 0.25 weight.
            # Aerial gets small credit (0.15) for canopy-level flycatchers.
            # Water strata get 0 — aquatic birds aren't forest-dependent.
            forest_weighted = (
                0.25 * ground
                + 1.0 * understory
                + 1.0 * midhigh
                + 0.95 * canopy
                + 0.15 * aerial
                + 0.0 * water_below
                + 0.0 * water_around
            )
            strat_score = forest_weighted / total_strat

        # ----- Diet Component -----
        # Frugivores and insectivores are more likely forest-dependent.
        # Granivores and scavengers tend to be open-habitat.
        diet_inv = self._to_float(row.get("Diet-Inv", 0))
        diet_fruit = self._to_float(row.get("Diet-Fruit", 0))
        diet_nect = self._to_float(row.get("Diet-Nect", 0))
        diet_seed = self._to_float(row.get("Diet-Seed", 0))
        diet_scav = self._to_float(row.get("Diet-Scav", 0))
        diet_vend = self._to_float(row.get("Diet-Vend", 0))
        diet_vect = self._to_float(row.get("Diet-Vect", 0))
        diet_vfish = self._to_float(row.get("Diet-Vfish", 0))
        diet_vunk = self._to_float(row.get("Diet-Vunk", 0))
        diet_planto = self._to_float(row.get("Diet-PlantO", 0))

        total_diet = (
            diet_inv + diet_fruit + diet_nect + diet_seed + diet_scav
            + diet_vend + diet_vect + diet_vfish + diet_vunk + diet_planto
        )

        if total_diet == 0:
            diet_score = 0.0
        else:
            # Forest-associated diet: fruit, nectar, invertebrates (partial)
            # Open-habitat diet: seeds, scavenging, fish
            forest_diet = (
                0.5 * diet_inv      # insectivores — many but not all are forest
                + 1.0 * diet_fruit  # frugivores — strong forest signal
                + 0.9 * diet_nect   # nectarivores — often forest edge/canopy
                + 0.05 * diet_seed  # granivores — mostly open habitat
                + 0.0 * diet_scav   # scavengers — open habitat
                + 0.4 * diet_vend   # vertebrate endo — mixed
                + 0.2 * diet_vect   # vertebrate ecto — mixed
                + 0.0 * diet_vfish  # fish — aquatic
                + 0.3 * diet_vunk   # unknown vertebrate — default moderate
                + 0.3 * diet_planto # other plant — moderate
            )
            diet_score = forest_diet / total_diet

        # ----- Combined Score -----
        # Stratum is the stronger signal (60%), diet supplements (40%)
        score = 0.6 * strat_score + 0.4 * diet_score

        return round(min(score, 1.0), 4)


if __name__ == "__main__":
    db = BirdTraitDB("./BirdFuncDat.txt")

    test_species = [
        ("Casuarius casuarius", "Southern Cassowary — forest obligate"),
        ("Passer domesticus", "House Sparrow — non-forest"),
        ("Lophophorus impejanus", "Himalayan Monal — forest floor"),
        ("Pycnonotus jocosus", "Red-whiskered Bulbul — forest edge"),
        ("Struthio camelus", "Ostrich — open savanna"),
        ("Pitta brachyura", "Indian Pitta — forest floor"),
        ("Corvus splendens", "House Crow — urban/open"),
        ("Dicrurus macrocercus", "Black Drongo — open/edge"),
        ("Psittacula eupatria", "Alexandrine Parakeet — forest canopy"),
    ]

    for name, desc in test_species:
        score = db.forest_dependency_score(name)
        if score is not None:
            bar = "█" * int(score * 20) + "░" * (20 - int(score * 20))
            print(f"  {name:30s} {bar} {score:.4f}  ({desc})")
        else:
            print(f"  {name:30s} NOT FOUND  ({desc})")
